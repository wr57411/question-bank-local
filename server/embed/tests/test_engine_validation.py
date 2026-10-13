"""引擎入参校验的拒绝路径测试（不加载模型）。

这些用例把 `embed_service.get_model` 换成桩，断言两件事：
1. 越界 / 非法结构 → 422；非 data: URI 的图片输入 → 400；
2. 上述拒绝路径**没有调用 `get_model`**，即校验发生在模型加载之前。

第 2 条同时钉住"先校验、后加载"这一顺序：若有人把 `get_model()` 挪回校验之前，
`probe.loads == 0` 会立刻变红。
"""

import base64

import pytest

import embed_service

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()

STUB_DIM = 4


class ModelProbe:
    """假模型：记录自己被加载了几次，并返回固定维度向量。"""

    def __init__(self):
        self.loads = 0
        self.encodes = 0

    def encode(self, inputs, batch_size=1, normalize_embeddings=True, convert_to_numpy=True):
        self.encodes += 1
        return [[0.1, 0.2, 0.3, 0.4] for _ in inputs]


@pytest.fixture
def probe(monkeypatch):
    stub = ModelProbe()

    def fake_get_model():
        stub.loads += 1
        return stub

    monkeypatch.setattr(embed_service, "get_model", fake_get_model)
    return stub


def test_texts_空数组返回422(client, probe):
    response = client.post("/encode-text", json={"texts": []})
    assert response.status_code == 422
    assert probe.loads == 0


def test_texts_65条返回422(client, probe):
    response = client.post("/encode-text", json={"texts": ["x"] * 65})
    assert response.status_code == 422
    assert probe.loads == 0


def test_texts_64条走通(client, probe):
    response = client.post("/encode-text", json={"texts": ["x"] * 64})
    assert response.status_code == 200
    assert response.json()["dim"] == STUB_DIM
    assert len(response.json()["vectors"]) == 64
    assert probe.loads == 1


def test_images_空数组返回422(client, probe):
    response = client.post("/encode-images", json={"images": []})
    assert response.status_code == 422
    assert probe.loads == 0


def test_images_9张返回422(client, probe):
    response = client.post("/encode-images", json={"images": [PNG_DATA_URI] * 9})
    assert response.status_code == 422
    assert probe.loads == 0


@pytest.mark.parametrize(
    "source",
    ["/etc/passwd", "/etc/hosts", "http://example.com/a.png", "https://example.com/a.png", "images/a.png"],
)
def test_images_非data_uri返回400且不加载模型(client, probe, source):
    response = client.post("/encode-images", json={"images": [source]})
    assert response.status_code == 400, f"{source!r} 应返回 400，实际 {response.status_code}"
    assert response.json().get("detail"), "400 响应必须带说明消息"
    assert probe.loads == 0


def test_images_混合输入含非data_uri整体拒绝(client, probe):
    response = client.post("/encode-images", json={"images": [PNG_DATA_URI, "/etc/passwd"]})
    assert response.status_code == 400
    assert probe.loads == 0


def test_images_正常data_uri走通(client, probe):
    response = client.post("/encode-images", json={"images": [PNG_DATA_URI]})
    assert response.status_code == 200
    body = response.json()
    assert body["dim"] == STUB_DIM
    assert len(body["vectors"]) == 1
    assert probe.loads == 1
