import os, sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
import embed_service

@pytest.fixture(scope="session")
def client():
    embed_service.MODEL_PATH = os.environ.get(
        "WEMM_MODEL_PATH",
        os.path.expanduser("~/.cache/huggingface/hub/models--tencent--WeMM-Embedding-2B/snapshots/bbd6cd4bf52cfc6716f752a2df80b2706720bd95"),
    )
    with TestClient(embed_service.app) as c:
        yield c
