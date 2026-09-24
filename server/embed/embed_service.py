import base64
import gc
import io
import json
import os
import threading
import time
from importlib.metadata import version as pkg_version

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

MODEL_PATH = os.environ.get(
    "WEMM_MODEL_PATH",
    os.path.expanduser("~/.cache/huggingface/hub/models--tencent--WeMM-Embedding-2B/snapshots/bbd6cd4bf52cfc6716f752a2df80b2706720bd95"),
)
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
IDLE_UNLOAD_SECONDS = int(os.environ.get("WEMM_IDLE_UNLOAD_SECONDS", "900"))


def _parse_memory_fraction(raw):
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(
            f"WEMM_MPS_MEMORY_FRACTION 必须是 (0, 1] 区间的数字，实际为 {raw!r}"
        ) from None
    if not 0.0 < value <= 1.0:
        raise ValueError(
            f"WEMM_MPS_MEMORY_FRACTION 必须是 (0, 1] 区间的数字，实际为 {value!r}"
        )
    return value


MPS_MEMORY_FRACTION = _parse_memory_fraction(os.environ.get("WEMM_MPS_MEMORY_FRACTION"))

app = FastAPI()
_dtype_cache = None
_model = None
_model_lock = threading.Lock()
_busy = 0
_last_used = 0.0
_encode_lock = threading.Lock()


def resolve_dtype():
    global _dtype_cache
    if _dtype_cache is None:
        value = None
        source = "fallback"
        try:
            with open(os.path.join(MODEL_PATH, "config.json"), encoding="utf-8") as f:
                candidate = json.load(f).get("dtype")
            if isinstance(candidate, str) and candidate:
                value, source = candidate, "config"
        except (OSError, ValueError, AttributeError):
            pass
        if value is None:
            value = str(torch.get_default_dtype()).replace("torch.", "")
        _dtype_cache = (value, source)
    return _dtype_cache


def get_model():
    global _model, _last_used, _busy
    with _model_lock:
        _last_used = time.time()
        if _model is None:
            if DEVICE == "mps" and MPS_MEMORY_FRACTION is not None:
                torch.mps.empty_cache()
                torch.mps.set_per_process_memory_fraction(MPS_MEMORY_FRACTION)
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(MODEL_PATH, trust_remote_code=True, device=DEVICE)
        _busy += 1
        return _model


def release_model():
    global _busy, _last_used
    with _model_lock:
        _busy = max(0, _busy - 1)
        _last_used = time.time()


def _l2_normalize(vectors):
    arr = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    return arr / np.clip(norms, 1e-12, None)


def _unload_watchdog():
    global _model
    while True:
        time.sleep(60)
        if IDLE_UNLOAD_SECONDS <= 0:
            continue
        with _model_lock:
            if _model is not None and _busy == 0 and time.time() - _last_used > IDLE_UNLOAD_SECONDS:
                _model = None
                gc.collect()
                if DEVICE == "mps":
                    torch.mps.empty_cache()
                elif DEVICE == "cuda":
                    torch.cuda.empty_cache()


threading.Thread(target=_unload_watchdog, daemon=True).start()


class TextRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=64)


class ImagesRequest(BaseModel):
    images: list[str] = Field(..., min_length=1, max_length=8)


@app.get("/health")
def health():
    dtype, dtype_source = resolve_dtype()
    if DEVICE == "mps":
        mps_recommended = torch.mps.recommended_max_memory()
        mps_driver_allocated = torch.mps.driver_allocated_memory()
        mps_current_allocated = torch.mps.current_allocated_memory()
    else:
        mps_recommended = None
        mps_driver_allocated = None
        mps_current_allocated = None
    return {"ok": True, "device": DEVICE, "model_loaded": _model is not None,
            "idle_unload_seconds": IDLE_UNLOAD_SECONDS,
            "model_path": MODEL_PATH, "dtype": dtype, "dtype_source": dtype_source,
            "torch": torch.__version__, "transformers": pkg_version("transformers"),
            "mps_recommended": mps_recommended,
            "mps_driver_allocated": mps_driver_allocated,
            "mps_current_allocated": mps_current_allocated}


@app.post("/encode-text")
def encode_text(req: TextRequest):
    model = get_model()
    try:
        with _encode_lock:
            vectors = model.encode(req.texts, batch_size=8, normalize_embeddings=True, convert_to_numpy=True)
            vectors = _l2_normalize(vectors)
    finally:
        release_model()
    return {"device": DEVICE, "dim": int(vectors.shape[1]), "vectors": vectors.tolist()}


@app.post("/encode-images")
def encode_images(req: ImagesRequest):
    for src in req.images:
        if not src.startswith("data:"):
            raise HTTPException(
                status_code=400,
                detail="只接受 data: URI 形式的图片输入；拒绝文件路径与 http(s) URL",
            )
    model = get_model()
    try:
        with _encode_lock:
            inputs = []
            for src in req.images:
                b64 = src.split(",", 1)[1]
                inputs.append({"image": Image.open(io.BytesIO(base64.b64decode(b64)))})
            vectors = model.encode(inputs, batch_size=1, normalize_embeddings=True, convert_to_numpy=True)
            vectors = _l2_normalize(vectors)
    finally:
        release_model()
    return {"device": DEVICE, "dim": int(vectors.shape[1]), "vectors": vectors.tolist()}
