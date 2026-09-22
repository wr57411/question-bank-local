import base64
import gc
import io
import os
import threading
import time

import numpy as np
import torch
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel, Field

MODEL_PATH = os.environ.get(
    "WEMM_MODEL_PATH",
    os.path.expanduser("~/.cache/huggingface/hub/models--tencent--WeMM-Embedding-2B/snapshots/bbd6cd4bf52cfc6716f752a2df80b2706720bd95"),
)
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
IDLE_UNLOAD_SECONDS = int(os.environ.get("WEMM_IDLE_UNLOAD_SECONDS", "900"))

app = FastAPI()
_model = None
_model_lock = threading.Lock()
_busy = 0
_last_used = 0.0
_encode_lock = threading.Lock()


def get_model():
    global _model, _last_used, _busy
    with _model_lock:
        _last_used = time.time()
        _busy += 1
        if _model is None:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(MODEL_PATH, trust_remote_code=True, device=DEVICE)
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
    texts: list[str] = Field(..., min_length=1)


class ImagesRequest(BaseModel):
    images: list[str]


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "model_loaded": _model is not None,
            "idle_unload_seconds": IDLE_UNLOAD_SECONDS}


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
    model = get_model()
    try:
        with _encode_lock:
            inputs = []
            for src in req.images:
                if src.startswith("data:"):
                    b64 = src.split(",", 1)[1]
                    inputs.append({"image": Image.open(io.BytesIO(base64.b64decode(b64)))})
                else:
                    inputs.append({"image": src})
            vectors = model.encode(inputs, batch_size=1, normalize_embeddings=True, convert_to_numpy=True)
            vectors = _l2_normalize(vectors)
    finally:
        release_model()
    return {"device": DEVICE, "dim": int(vectors.shape[1]), "vectors": vectors.tolist()}
