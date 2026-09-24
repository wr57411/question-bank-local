import { remoteCall } from '../../data/sync';
import type { Engine, EngineId, Modality } from './types';

interface HealthResponse {
  fingerprint?: string;
  dtype?: string;
}

interface EncodeResponse {
  dim?: number;
  vectors?: number[][];
}

function firstVector(res: EncodeResponse): Float32Array {
  const v = res?.vectors?.[0];
  if (!Array.isArray(v) || v.length === 0) throw new Error('编码服务未返回向量');
  return Float32Array.from(v);
}

export class HttpEngine implements Engine {
  readonly id: EngineId;
  readonly modalities: Modality[];
  private _fingerprint: string;
  private _dtype = '';

  constructor(id: EngineId, fingerprint: string, modalities: Modality[] = ['text', 'image']) {
    this.id = id;
    this._fingerprint = fingerprint;
    this.modalities = modalities;
  }

  get fingerprint(): string {
    return this._fingerprint;
  }

  get dtype(): string {
    return this._dtype;
  }

  async health(signal?: AbortSignal): Promise<{ fingerprint: string; dtype: string }> {
    if (signal?.aborted) throw new Error('已取消');
    const res = (await remoteCall(
      `/api/embed/health?engineId=${encodeURIComponent(this.id)}`,
    )) as HealthResponse;
    const fingerprint =
      typeof res?.fingerprint === 'string' && res.fingerprint ? res.fingerprint : this._fingerprint;
    const dtype = typeof res?.dtype === 'string' ? res.dtype : '';
    this._fingerprint = fingerprint;
    this._dtype = dtype;
    return { fingerprint, dtype };
  }

  async probe(signal?: AbortSignal): Promise<{ ok: boolean; fingerprint: string }> {
    try {
      const h = await this.health(signal);
      return { ok: true, fingerprint: h.fingerprint };
    } catch {
      return { ok: false, fingerprint: '' };
    }
  }

  async encode(
    input: { kind: 'text'; text: string } | { kind: 'image'; dataUrl: string },
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    if (signal?.aborted) throw new Error('已取消');
    if (input.kind === 'image') {
      const res = (await remoteCall(`/api/embed/image?engineId=${encodeURIComponent(this.id)}`, 'POST', {
        image: input.dataUrl,
      })) as EncodeResponse;
      return firstVector(res);
    }
    const res = (await remoteCall(`/api/embed/text?engineId=${encodeURIComponent(this.id)}`, 'POST', {
      texts: [input.text],
    })) as EncodeResponse;
    return firstVector(res);
  }
}
