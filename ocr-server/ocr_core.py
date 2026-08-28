import argparse
import base64
import io
import os
import threading

import numpy as np
from PIL import Image

MATH_SYMBOLS = set("=∫∑√πθωαβγλμΔ≈≠≤≥±×÷∞→")

_engine = None
_engine_lock = threading.Lock()
_loading = False
_load_error = None


class OCRCore:
    def __init__(self):
        self.paddle = None
        self.unimer = None
        self.paddle_ready = False
        self.unimer_ready = False
        self._load()

    def _load(self):
        self.paddle_error = None
        self.unimer_error = None
        try:
            from paddleocr import PaddleOCR

            self.paddle = PaddleOCR(lang="ch")
            self.paddle_ready = True
        except Exception as e:
            self.paddle_error = str(e)

        try:
            import torch
            from unimernet.common.config import Config
            from unimernet.processors import load_processor
            import unimernet.tasks as tasks

            model_dir = os.environ.get("UNIMER_MODEL_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "unimer"))
            cfg_path = os.environ.get("UNIMER_CFG_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "unimer_demo.yaml"))
            args = argparse.Namespace(cfg_path=cfg_path, options=None)
            cfg = Config(args)
            self._device = torch.device("cpu")
            task = tasks.setup_task(cfg)
            self.unimer = task.build_model(cfg).to(self._device)
            self.unimer.eval()
            self.vis_processor = load_processor("formula_image_eval", cfg.config.datasets.formula_rec_eval.vis_processor.eval)
            self.unimer_ready = True
        except Exception as e:
            self.unimer_error = str(e)

    def status(self):
        if not self.paddle_ready and not self.unimer_ready:
            return "error"
        return "ready"

    def health(self):
        return {
            "status": self.status(),
            "engines": {"paddle": self.paddle_ready, "unimer": self.unimer_ready},
            "errors": {"paddle": self.paddle_error, "unimer": self.unimer_error},
        }

    def recognize(self, image: Image.Image):
        text_lines = self._ocr_text_lines(image)
        lines = []
        formulas = []
        for box, text in text_lines:
            if self.unimer_ready and _looks_like_formula(text) and box is not None:
                crop = _crop_box(image, box)
                latex = self._recognize_formula(crop)
                if latex:
                    formulas.append(latex)
                    lines.append((box, f"$${latex}$$", "formula"))
                    continue
            lines.append((box, text, "text"))

        lines.sort(key=lambda item: (_center_y(item[0]), _center_x(item[0])) if item[0] is not None else (0, 0))
        markdown = "\n".join(item[1] for item in lines)
        text = "\n".join(item[1] for item in lines if item[2] == "text")
        return {"text": text, "formulas": formulas, "markdown": markdown}

    def _ocr_text_lines(self, image: Image.Image):
        if not self.paddle_ready:
            return []
        img = np.array(image.convert("RGB"))
        try:
            result = self.paddle.predict(img)
        except Exception:
            try:
                result = self.paddle.ocr(img, cls=True)
            except Exception:
                return []
        return _extract_lines(result)

    def _recognize_formula(self, crop: Image.Image):
        try:
            import torch

            image = self.vis_processor(crop).unsqueeze(0).to(self._device)
            with torch.no_grad():
                output = self.unimer.generate({"image": image})
            pred = output.get("pred_str") or output.get("preds")
            if pred:
                return str(pred[0]).strip()
        except Exception:
            return None
        return None


def _extract_lines(result):
    lines = []
    if not result:
        return lines
    for page in result:
        if isinstance(page, dict):
            texts = page.get("rec_texts") or []
            polys = page.get("rec_polys") or page.get("dt_polys") or []
            for i, t in enumerate(texts):
                box = polys[i] if i < len(polys) else None
                lines.append((box, str(t).strip()))
        elif isinstance(page, list):
            for item in page:
                if not item or len(item) < 2:
                    continue
                info = item[1]
                text = info[0] if isinstance(info, (list, tuple)) else info
                box = item[0] if len(item[0]) >= 4 else None
                if text:
                    lines.append((box, str(text).strip()))
    return lines


def _looks_like_formula(text):
    if not text:
        return False
    if "=" in text and len(text) >= 3:
        return True
    symbol_count = sum(1 for ch in text if ch in MATH_SYMBOLS)
    return symbol_count >= 2


def _crop_box(image: Image.Image, box):
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    left, right = int(min(xs)), int(max(xs))
    top, bottom = int(min(ys)), int(max(ys))
    pad = 4
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(image.width, right + pad)
    bottom = min(image.height, bottom + pad)
    return image.crop((left, top, right, bottom))


def _center_y(box):
    if box is None:
        return 0
    return sum(p[1] for p in box) / len(box)


def _center_x(box):
    if box is None:
        return 0
    return sum(p[0] for p in box) / len(box)


def _decode_image(image_base64):
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]
    raw = base64.b64decode(image_base64)
    return Image.open(io.BytesIO(raw))


def get_engine_status():
    global _loading, _load_error
    if _engine is not None:
        return _engine.health()
    if _loading:
        return {"status": "loading", "engines": {"paddle": False, "unimer": False}, "errors": {}}
    if _load_error:
        return {"status": "error", "engines": {"paddle": False, "unimer": False}, "errors": {"load": _load_error}}
    return {"status": "not_loaded", "engines": {"paddle": False, "unimer": False}, "errors": {}}


def run_ocr(image_base64):
    global _engine, _loading, _load_error
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _loading = True
                _load_error = None
                try:
                    _engine = OCRCore()
                except Exception as e:
                    _load_error = str(e)
                    raise RuntimeError(f"OCR 引擎加载失败: {e}")
                finally:
                    _loading = False
    image = _decode_image(image_base64)
    return _engine.recognize(image)
