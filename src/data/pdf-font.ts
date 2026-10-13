let cached: string | null = null;
let loading: Promise<string | null> | null = null;

export function loadCnFontBase64(): Promise<string | null> {
  if (cached !== null) return Promise.resolve(cached);
  if (loading) return loading;
  loading = (async () => {
    for (const p of ['fonts/NotoSansSC-Regular.ttf', './fonts/NotoSansSC-Regular.ttf', '/public/fonts/NotoSansSC-Regular.ttf']) {
      try {
        const resp = await fetch(p);
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          cached = btoa(binary);
          return cached;
        }
      } catch {}
    }
    return null;
  })();
  return loading;
}
