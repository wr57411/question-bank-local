"""编码引擎契约一致性测试（对任意 `EMBED_SERVICE_URL` 都能跑）。

⚠️ 运行前**必须**确认 `EMBED_SERVICE_URL` 指向**本 worktree 启动的服务**。
本机多个 worktree 并行时端口会被劫持（见 `AGENTS.md`「多 worktree 端口劫持」）：
谁先起服务谁占 3002，默认地址可能打到**另一个 worktree 的代码**，于是这份测试
静默测错对象，产出的红/绿一律不可采信。

确认占用 3002 的进程是不是本 worktree：

    lsof -nP -iTCP:3002 -sTCP:LISTEN -t | xargs -I{} lsof -p {} | grep cwd

cwd 必须落在本 worktree 的 `server/embed` 下；否则用独立端口指向本 worktree 的服务：

    EMBED_SERVICE_URL=http://127.0.0.1:3102 pytest tests/test_engine_contract.py -v
"""

import base64
import os

import httpx
import pytest

BASE_URL = os.environ.get("EMBED_SERVICE_URL", "http://127.0.0.1:3002").rstrip("/")
TIMEOUT = float(os.environ.get("EMBED_SERVICE_TIMEOUT", "120"))

REQUIRED_HEALTH_FIELDS = ("ok", "device", "model_loaded", "model_path", "dtype", "torch", "transformers")
NON_EMPTY_STRING_HEALTH_FIELDS = ("device", "model_path", "dtype", "torch", "transformers")
OPTIONAL_HEALTH_FIELD_TYPES = {
    "idle_unload_seconds": int,
    "dim": int,
    "batch": int,
    "image_dir": str,
    "dtype_source": str,
}

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()


def request(method, path, **kwargs):
    with httpx.Client(base_url=BASE_URL, timeout=TIMEOUT, trust_env=False) as client:
        return client.request(method, path, **kwargs)


def assert_vectors_shape(body, expected_count):
    assert isinstance(body["dim"], int) and body["dim"] > 0, f"dim 必须是正整数：{body.get('dim')!r}"
    vectors = body["vectors"]
    assert isinstance(vectors, list), f"vectors 必须是数组：{vectors!r}"
    assert len(vectors) == expected_count, f"vectors 条数 {len(vectors)} != 请求条数 {expected_count}"
    for index, vector in enumerate(vectors):
        assert isinstance(vector, list), f"vectors[{index}] 必须是数组"
        assert len(vector) == body["dim"], f"vectors[{index}] 长度 {len(vector)} != dim {body['dim']}"
        assert all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in vector), f"vectors[{index}] 含非数值"
    if "device" in body:
        assert isinstance(body["device"], str) and body["device"], "device 可选，但出现时必须是非空字符串"


@pytest.fixture(scope="session")
def engine():
    try:
        request("GET", "/health")
    except httpx.HTTPError as exc:
        pytest.skip(
            f"引擎不可达，跳过契约测试：{BASE_URL}（{exc!r}）。"
            "若预期该端口有服务，先确认它属于本 worktree：lsof -p <PID> | grep cwd"
        )
    return BASE_URL


def test_health_必需字段齐全(engine):
    response = request("GET", "/health")
    assert response.status_code == 200, f"/health 应返回 200，实际 {response.status_code}"
    body = response.json()
    assert isinstance(body, dict)
    missing = [field for field in REQUIRED_HEALTH_FIELDS if field not in body]
    assert not missing, f"/health 缺必需字段：{missing}"
    assert body["ok"] is True, "/health.ok 必须为 true"
    assert isinstance(body["model_loaded"], bool), "/health.model_loaded 必须是布尔"
    for field in NON_EMPTY_STRING_HEALTH_FIELDS:
        assert isinstance(body[field], str) and body[field], f"/health.{field} 必须是非空字符串"


def test_health_可选字段类型正确(engine):
    body = request("GET", "/health").json()
    for field, expected_type in OPTIONAL_HEALTH_FIELD_TYPES.items():
        if field in body and body[field] is not None:
            assert isinstance(body[field], expected_type), f"/health.{field} 类型应为 {expected_type.__name__}"


def test_三条路由都存在(engine):
    assert request("GET", "/health").status_code != 404
    assert request("POST", "/encode-text", json={"texts": ["探活"]}).status_code != 404
    assert request("POST", "/encode-images", json={"images": [PNG_DATA_URI]}).status_code != 404


def test_未定义路由返回404(engine):
    assert request("GET", "/definitely-not-a-contract-route").status_code == 404


def test_encode_text_响应形状(engine):
    response = request("POST", "/encode-text", json={"texts": ["斜面上滑块的摩擦力分析"]})
    assert response.status_code == 200, f"/encode-text 应返回 200，实际 {response.status_code}"
    assert_vectors_shape(response.json(), 1)


def test_encode_text_多条进多条出(engine):
    response = request("POST", "/encode-text", json={"texts": ["甲", "乙", "丙"]})
    assert response.status_code == 200
    assert_vectors_shape(response.json(), 3)


def test_encode_text_拒绝空数组(engine):
    assert request("POST", "/encode-text", json={"texts": []}).status_code == 422


def test_encode_text_拒绝超过64条(engine):
    assert request("POST", "/encode-text", json={"texts": ["x"] * 65}).status_code == 422


def test_encode_text_拒绝非法结构(engine):
    assert request("POST", "/encode-text", json={}).status_code == 422
    assert request("POST", "/encode-text", json={"texts": "not-a-list"}).status_code == 422


def test_encode_images_响应形状(engine):
    response = request("POST", "/encode-images", json={"images": [PNG_DATA_URI]})
    assert response.status_code == 200, f"/encode-images 应返回 200，实际 {response.status_code}"
    assert_vectors_shape(response.json(), 1)


def test_encode_images_拒绝非_data_uri(engine):
    for source in ("/etc/hosts", "http://example.com/a.png", "images/a.png"):
        response = request("POST", "/encode-images", json={"images": [source]})
        assert response.status_code == 400, f"非 data: URI 的输入 {source!r} 应返回 400，实际 {response.status_code}"
        assert response.json().get("detail"), "400 响应必须带说明消息"


def test_encode_images_拒绝空数组(engine):
    assert request("POST", "/encode-images", json={"images": []}).status_code == 422


def test_encode_images_拒绝超过8张(engine):
    assert request("POST", "/encode-images", json={"images": [PNG_DATA_URI] * 9}).status_code == 422


def test_encode_images_拒绝非法结构(engine):
    assert request("POST", "/encode-images", json={}).status_code == 422
    assert request("POST", "/encode-images", json={"images": "not-a-list"}).status_code == 422
