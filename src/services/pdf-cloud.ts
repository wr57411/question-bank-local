import { dbAddPdfDoc, dbUpdatePdfDoc } from '../data/pdf-docs';
import type { PdfDoc } from '../types';

export async function uploadPdfToServer(file: File, filename: string, categoryId?: string): Promise<PdfDoc> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', filename);
  if (categoryId) formData.append('category_id', categoryId);

  const serverUrl = localStorage.getItem('serverUrl') || '';
  const apiToken = localStorage.getItem('apiToken') || '';
  const url = serverUrl.replace(/\/+$/, '') + '/api/pdfs/upload';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}` },
    body: formData,
  });
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    throw new Error(`上传失败: ${response.status} ${detail}`);
  }
  const result = await response.json() as { id: string; filename: string; page_count: number; file_size: number; server_path: string };

  const doc: PdfDoc = {
    id: result.id,
    filename: result.filename,
    page_count: result.page_count,
    file_size: result.file_size,
    server_path: result.server_path,
    category_id: categoryId,
    created_at: new Date().toISOString(),
    tag_ids: [],
  };
  await dbAddPdfDoc(doc);

  try {
    const cachePath = await downloadPdfToLocal(doc.id);
    doc.local_cache_path = cachePath;
  } catch (e) { console.warn('PDF 缓存下载失败:', e); }

  return doc;
}

export async function fetchPdfPages(pdfId: string, from: number, to: number): Promise<{ pages: { page: number; image_url: string }[]; total_pages: number }> {
  const serverUrl = localStorage.getItem('serverUrl') || '';
  const apiToken = localStorage.getItem('apiToken') || '';
  const url = serverUrl.replace(/\/+$/, '') + `/api/pdfs/${pdfId}/pages?from=${from}&to=${to}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiToken}` } });
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    throw new Error(`加载预览失败: ${response.status} ${detail}`);
  }
  return response.json() as Promise<{ pages: { page: number; image_url: string }[]; total_pages: number }>;
}

export async function downloadPdfToLocal(pdfId: string): Promise<string> {
  const serverUrl = localStorage.getItem('serverUrl') || '';
  const apiToken = localStorage.getItem('apiToken') || '';
  if (!serverUrl) throw new Error('未配置服务器地址');

  const url = serverUrl.replace(/\/+$/, '') + `/api/pdfs/${pdfId}/download`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });
  if (!response.ok) throw new Error(`下载失败: ${response.status}`);

  const blob = await response.blob();

  if (!('Capacitor' in window)) {
    const fileName = `pdf_${pdfId}.pdf`;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    }, 3000);
    return 'browser-download';
  }

  const reader = new FileReader();
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });

  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const fileName = `pdf_cache_${pdfId}.pdf`;
  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });

  const uriResult = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
  await dbUpdatePdfDoc(pdfId, { local_cache_path: uriResult.uri });
  return uriResult.uri;
}

export async function deleteRemotePdf(pdfId: string): Promise<void> {
  const serverUrl = localStorage.getItem('serverUrl') || '';
  const apiToken = localStorage.getItem('apiToken') || '';
  const response = await fetch(serverUrl.replace(/\/+$/, '') + `/api/pdfs/${pdfId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });
  if (!response.ok) throw new Error(`删除失败: ${response.status}`);
}

export async function updateRemotePdfMeta(pdfId: string, meta: { filename?: string; category_id?: string }): Promise<void> {
  const serverUrl = localStorage.getItem('serverUrl') || '';
  const apiToken = localStorage.getItem('apiToken') || '';
  const response = await fetch(serverUrl.replace(/\/+$/, '') + `/api/pdfs/${pdfId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
    body: JSON.stringify(meta),
  });
  if (!response.ok) throw new Error(`更新失败: ${response.status}`);
  await dbUpdatePdfDoc(pdfId, meta);
}

export async function setPdfTagsRemote(pdfId: string, tagIds: string[]): Promise<void> {
  const serverUrl = localStorage.getItem('serverUrl') || '';
  const apiToken = localStorage.getItem('apiToken') || '';
  const response = await fetch(serverUrl.replace(/\/+$/, '') + `/api/pdfs/${pdfId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
    body: JSON.stringify({ tag_ids: tagIds }),
  });
  if (!response.ok) throw new Error(`标签更新失败: ${response.status}`);
}
