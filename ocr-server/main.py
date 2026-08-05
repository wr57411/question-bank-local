from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ocr_core import get_engine_status, run_ocr

app = FastAPI(title="Local OCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class OcrRequest(BaseModel):
    image_base64: str


@app.get("/health")
def health():
    return get_engine_status()


@app.post("/ocr")
def ocr(req: OcrRequest):
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 不能为空")
    try:
        return run_ocr(req.image_base64)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
