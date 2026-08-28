export function compressImage(input: string | File | Blob, maxWidth = 800, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > maxWidth) { height = (maxWidth / width) * height; width = maxWidth; }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    if (typeof input === 'string') {
      img.src = input;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target!.result as string; };
      reader.onerror = reject;
      reader.readAsDataURL(input);
    }
  });
}

export function mergeImagesVertically(dataUrl1: string, dataUrl2: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img1 = new Image();
    const img2 = new Image();
    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded < 2) return;
      const canvas = document.createElement('canvas');
      const w = Math.max(img1.width, img2.width);
      const h = img1.height + img2.height;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img1, 0, 0);
      ctx.drawImage(img2, 0, img1.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img1.onload = onLoad;
    img2.onload = onLoad;
    img1.onerror = reject;
    img2.onerror = reject;
    img1.src = dataUrl1;
    img2.src = dataUrl2;
  });
}

export function dataURLtoBlob(dataurl: string): Blob {
  const arr = dataurl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}
