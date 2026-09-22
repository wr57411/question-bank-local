import base64

TEXT_DIM = 2048

# 1x1 红色 PNG（占位，仅验证链路与维度）
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def test_encode_text(client):
    r = client.post("/encode-text", json={"texts": ["斜面上滑块的摩擦力分析"]})
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == TEXT_DIM
    vec = body["vectors"][0]
    assert len(vec) == TEXT_DIM
    norm = sum(x * x for x in vec) ** 0.5
    assert abs(norm - 1.0) < 1e-3


def test_encode_images(client):
    data_url = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()
    r = client.post("/encode-images", json={"images": [data_url, data_url]})
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == TEXT_DIM
    assert len(body["vectors"]) == 2


def test_encode_text_rejects_bad_input(client):
    assert client.post("/encode-text", json={"texts": []}).status_code == 422


def test_concurrent_encode_serialized():
    import threading
    from embed_service import encode_text, TextRequest

    results = []
    errors = []

    def call(i):
        try:
            r = encode_text(TextRequest(texts=[f"并发锁验证第{i}句 斜面滑块"]))
            results.append((i, r["dim"]))
        except Exception as e:
            errors.append((i, repr(e)))

    threads = [threading.Thread(target=call, args=(i,)) for i in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)

    assert not errors, f"并发编码报错: {errors}"
    assert sorted(results) == [(0, 2048), (1, 2048), (2, 2048)]
