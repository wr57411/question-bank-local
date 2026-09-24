import os
import subprocess
import sys
import types

import pytest

import embed_service


class _FakeMps:
    def __init__(self, log):
        self.log = log

    def empty_cache(self):
        self.log.append(("empty_cache", None))

    def set_per_process_memory_fraction(self, fraction):
        self.log.append(("set_per_process_memory_fraction", fraction))

    def recommended_max_memory(self):
        return 12124 * 1024 * 1024

    def driver_allocated_memory(self):
        return 5828 * 1024 * 1024

    def current_allocated_memory(self):
        return 1024 * 1024


def _fake_torch(log):
    return types.SimpleNamespace(mps=_FakeMps(log), __version__="2.14.0")


def _fake_sentence_transformers(log):
    class _FakeSentenceTransformer:
        def __init__(self, *args, **kwargs):
            log.append(("SentenceTransformer", (args, kwargs)))

    module = types.ModuleType("sentence_transformers")
    module.SentenceTransformer = _FakeSentenceTransformer
    return module


@pytest.fixture
def load_probe(monkeypatch):
    log = []
    monkeypatch.setattr(embed_service, "torch", _fake_torch(log))
    monkeypatch.setitem(sys.modules, "sentence_transformers", _fake_sentence_transformers(log))
    monkeypatch.setattr(embed_service, "_model", None)
    return log


def _names(log):
    return [name for name, _ in log]


def test_未设fraction时mps不设上限(load_probe, monkeypatch):
    monkeypatch.setattr(embed_service, "DEVICE", "mps")
    monkeypatch.setattr(embed_service, "MPS_MEMORY_FRACTION", None)
    embed_service.get_model()
    assert _names(load_probe) == ["SentenceTransformer"]


def test_mps上设了fraction以对应值调用(load_probe, monkeypatch):
    monkeypatch.setattr(embed_service, "DEVICE", "mps")
    monkeypatch.setattr(embed_service, "MPS_MEMORY_FRACTION", 0.6)
    embed_service.get_model()
    assert ("set_per_process_memory_fraction", 0.6) in load_probe


def test_非mps设备不调用上限(load_probe, monkeypatch):
    monkeypatch.setattr(embed_service, "DEVICE", "cpu")
    monkeypatch.setattr(embed_service, "MPS_MEMORY_FRACTION", 0.6)
    embed_service.get_model()
    names = _names(load_probe)
    assert "set_per_process_memory_fraction" not in names
    assert "empty_cache" not in names
    assert "SentenceTransformer" in names


def test_上限调用先于模型加载(load_probe, monkeypatch):
    monkeypatch.setattr(embed_service, "DEVICE", "mps")
    monkeypatch.setattr(embed_service, "MPS_MEMORY_FRACTION", 0.6)
    embed_service.get_model()
    names = _names(load_probe)
    assert names.index("empty_cache") < names.index("SentenceTransformer")
    assert names.index("set_per_process_memory_fraction") < names.index("SentenceTransformer")


def test_加载失败时不泄漏busy(monkeypatch):
    def _boom(*args, **kwargs):
        raise RuntimeError("模拟加载失败")

    module = types.ModuleType("sentence_transformers")
    module.SentenceTransformer = _boom
    monkeypatch.setitem(sys.modules, "sentence_transformers", module)
    monkeypatch.setattr(embed_service, "torch", _fake_torch([]))
    monkeypatch.setattr(embed_service, "DEVICE", "cpu")
    monkeypatch.setattr(embed_service, "MPS_MEMORY_FRACTION", None)
    monkeypatch.setattr(embed_service, "_model", None)
    monkeypatch.setattr(embed_service, "_busy", 0)
    with pytest.raises(RuntimeError):
        embed_service.get_model()
    assert embed_service._busy == 0, "加载失败时调用方没拿到模型，_busy 必须不增，否则永久泄漏并阻断 idle-unload"


@pytest.mark.parametrize("raw", ["abc", "", "0", "-0.2", "1.5", "nan", "inf"])
def test_非法fraction响亮失败(raw):
    with pytest.raises(ValueError):
        embed_service._parse_memory_fraction(raw)


@pytest.mark.parametrize("raw,expected", [("0.5", 0.5), ("1", 1.0), ("0.75", 0.75)])
def test_合法fraction被解析(raw, expected):
    assert embed_service._parse_memory_fraction(raw) == expected


def test_env变量名生效(monkeypatch):
    monkeypatch.setenv("WEMM_MPS_MEMORY_FRACTION", "0.55")
    assert embed_service._parse_memory_fraction(os.environ.get("WEMM_MPS_MEMORY_FRACTION")) == 0.55


def test_未设env解析为None(monkeypatch):
    monkeypatch.delenv("WEMM_MPS_MEMORY_FRACTION", raising=False)
    assert embed_service._parse_memory_fraction(os.environ.get("WEMM_MPS_MEMORY_FRACTION")) is None


def _run_import(fraction):
    embed_dir = os.path.dirname(os.path.abspath(embed_service.__file__))
    env = dict(os.environ)
    env.pop("WEMM_MPS_MEMORY_FRACTION", None)
    if fraction is not None:
        env["WEMM_MPS_MEMORY_FRACTION"] = fraction
    env["PYTHONPATH"] = embed_dir
    return subprocess.run(
        [sys.executable, "-c", "import embed_service"],
        cwd=embed_dir,
        env=env,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize("raw", ["abc", "0", "1.5"])
def test_非法fraction导致启动失败(raw):
    result = _run_import(raw)
    assert result.returncode != 0, "非法 fraction 必须让服务启动失败，而不是静默忽略"
    assert "WEMM_MPS_MEMORY_FRACTION" in (result.stderr + result.stdout)


def test_合法fraction可正常启动():
    result = _run_import("0.6")
    assert result.returncode == 0, result.stderr


def test_health_三字段存在且非mps为null(client, monkeypatch):
    monkeypatch.setattr(embed_service, "DEVICE", "cpu")
    body = client.get("/health").json()
    assert "mps_recommended" in body
    assert "mps_driver_allocated" in body
    assert "mps_current_allocated" in body
    assert body["mps_recommended"] is None
    assert body["mps_driver_allocated"] is None
    assert body["mps_current_allocated"] is None


def test_health_mps时三字段为数值(client, monkeypatch):
    monkeypatch.setattr(embed_service, "DEVICE", "mps")
    monkeypatch.setattr(embed_service, "torch", _fake_torch([]))
    body = client.get("/health").json()
    assert body["mps_recommended"] == 12124 * 1024 * 1024
    assert body["mps_driver_allocated"] == 5828 * 1024 * 1024
    assert body["mps_current_allocated"] == 1024 * 1024
