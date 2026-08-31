/* eslint-disable @typescript-eslint/no-explicit-any */
import { closeModal, openModal } from './common';
const w = window as any;

let currentNoteVersions: any[] = [];
let currentNoteVersionId: string | null = null;
let addNoteVersionImage: string | null = null;

export async function loadNoteVersionsForDetail(questionId: string): Promise<void> {
  const myToken = ++w._detailLoadToken;
  currentNoteVersions = await w.dbGetQuestionNotes(questionId);
  if (myToken !== w._detailLoadToken) return;
  const select = document.getElementById('modal-note-version-select') as HTMLSelectElement;
  const bar = document.getElementById('modal-note-version-bar')!;
  const imgDiv = document.getElementById('modal-question-image')!;
  const textDiv = document.getElementById('modal-question-text-note') as HTMLElement;

  if (currentNoteVersions.length === 0) {
    const q = w.allQuestions.find((q: any) => q.id === questionId);
    if (q && q.question_image_url) {
      const note = await w.dbAddQuestionNote(questionId, q.question_image_url, '笔记 v1', '');
      currentNoteVersions = [note];
    }
  }

  if (currentNoteVersions.length === 0) {
    bar.style.display = 'none';
    imgDiv.innerHTML = '<div style="text-align:center;padding:20px"><p style="color:var(--text-tertiary);margin-bottom:12px">暂无题目图片</p><button onclick="showAddNoteVersionModal()" style="padding:8px 16px;font-size:13px">📷 添加题目图片</button></div>';
    textDiv.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  select.innerHTML = '';
  currentNoteVersions.forEach((n: any) => { const opt = document.createElement('option'); opt.value = n.id; opt.textContent = n.label || '笔记'; select.appendChild(opt); });
  const lastId = w.dbGetLastViewedNote(questionId);
  const lastNote = currentNoteVersions.find((n: any) => n.id === lastId);
  if (lastNote) select.value = lastId;
  displayCurrentNoteVersion();
}

export async function displayCurrentNoteVersion(): Promise<void> {
  const select = document.getElementById('modal-note-version-select') as HTMLSelectElement;
  const noteId = select.value;
  const note = currentNoteVersions.find((n: any) => n.id === noteId);
  if (!note) return;
  currentNoteVersionId = noteId;
  w.dbSetLastViewedNote(w.currentQuestionId, noteId);
  const imgDiv = document.getElementById('modal-question-image')!;
  imgDiv.innerHTML = '<img src="' + note.note_image_url + '" style="max-width:100%;border-radius:8px">';
  const textarea = document.getElementById('modal-question-text-note') as HTMLTextAreaElement;
  textarea.value = note.text_note || '';
}

export function saveTextNote(): void {
  if (!currentNoteVersionId) return;
  const textarea = document.getElementById('modal-question-text-note') as HTMLTextAreaElement;
  const text = textarea.value;
  w.dbUpdateQuestionNote(currentNoteVersionId, { text_note: text });
  const note = currentNoteVersions.find((n: any) => n.id === currentNoteVersionId);
  if (note) note.text_note = text;
  w.showStatus('笔记已保存', 'success');
}

export function switchNoteVersion(_noteId: string): void { displayCurrentNoteVersion(); }

export function showAddNoteVersionModal(): void {
  addNoteVersionImage = null;
  (document.getElementById('note-version-label') as HTMLInputElement).value = '';
  (document.getElementById('note-version-text') as HTMLInputElement).value = '';
  document.getElementById('note-version-preview-wrap')!.style.display = 'none';
  openModal('add-note-version-modal');
}

export function closeAddNoteVersionModal(): void {
  closeModal('add-note-version-modal');
  addNoteVersionImage = null;
}

export function takePhotoForNoteVersion(_target?: string): void {
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  const Camera = isNative ? w.Capacitor.Plugins.Camera : null;
  if (isNative && Camera) {
    Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' })
      .then((photo: any) => { addNoteVersionImage = photo.dataUrl; (document.getElementById('note-version-preview') as HTMLImageElement).src = photo.dataUrl; document.getElementById('note-version-preview-wrap')!.style.display = 'inline-block'; })
      .catch((e: any) => { if (e.message !== 'User cancelled photos app') w.showStatus('拍照失败: ' + e.message, 'error'); });
  } else {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    input.onchange = (e: any) => { if (e.target.files && e.target.files[0]) { const reader = new FileReader(); reader.onload = (ev: any) => { addNoteVersionImage = ev.target.result; (document.getElementById('note-version-preview') as HTMLImageElement).src = ev.target.result; document.getElementById('note-version-preview-wrap')!.style.display = 'inline-block'; }; reader.readAsDataURL(e.target.files[0]); } };
    input.click();
  }
}

export function pickFromGalleryForNoteVersion(_target?: string): void {
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  const Camera = isNative ? w.Capacitor.Plugins.Camera : null;
  if (isNative && Camera) {
    Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'PHOTOS' })
      .then((photo: any) => { addNoteVersionImage = photo.dataUrl; (document.getElementById('note-version-preview') as HTMLImageElement).src = photo.dataUrl; document.getElementById('note-version-preview-wrap')!.style.display = 'inline-block'; })
      .catch((e: any) => { if (e.message !== 'User cancelled photos app') w.showStatus('选择图片失败: ' + e.message, 'error'); });
  } else {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e: any) => { if (e.target.files && e.target.files[0]) { const reader = new FileReader(); reader.onload = (ev: any) => { addNoteVersionImage = ev.target.result; (document.getElementById('note-version-preview') as HTMLImageElement).src = ev.target.result; document.getElementById('note-version-preview-wrap')!.style.display = 'inline-block'; }; reader.readAsDataURL(e.target.files[0]); } };
    input.click();
  }
}

export function removeNoteVersionImage(): void {
  addNoteVersionImage = null;
  document.getElementById('note-version-preview-wrap')!.style.display = 'none';
}

export async function confirmAddNoteVersion(): Promise<void> {
  if (!w.currentQuestionId) return;
  if (!addNoteVersionImage) { w.showStatus('请先选择题目图片', 'error'); return; }
  const label = (document.getElementById('note-version-label') as HTMLInputElement).value.trim() || '笔记 ' + (currentNoteVersions.length + 1);
  const textNote = (document.getElementById('note-version-text') as HTMLInputElement).value.trim();
  const note = await w.dbAddQuestionNote(w.currentQuestionId, addNoteVersionImage, label, textNote);
  closeAddNoteVersionModal();
  await loadNoteVersionsForDetail(w.currentQuestionId);
  (document.getElementById('modal-note-version-select') as HTMLSelectElement).value = note.id;
  displayCurrentNoteVersion();
  w.showStatus('笔记版本已添加', 'success');
}

// 创建时额外版本管理
export function addExtraNoteVersion(): void {
  w.extraNoteVersionCounter++;
  const idx = w.extraNoteVersionCounter;
  const container = document.getElementById('extra-note-versions')!;
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:var(--radius-md)';
  div.id = 'extra-note-' + idx;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;color:var(--text-secondary);font-weight:600">版本 ${idx + 1}</span><button type="button" onclick="removeExtraNoteVersion(${idx})" style="padding:2px 8px;font-size:11px;background:var(--danger);color:#fff;border:none;border-radius:4px;cursor:pointer">删除</button></div><div class="upload-buttons"><button type="button" class="upload-btn camera" onclick="takePhotoForExtra('extra_${idx}')" style="font-size:12px;padding:10px">📷 拍照</button><button type="button" class="upload-btn" onclick="pickFromGalleryForExtra('extra_${idx}')" style="background:var(--surface-dim);color:var(--text-secondary);box-shadow:0 2px 0 var(--border);font-size:12px;padding:10px">🖼️ 相册</button></div><div class="preview-wrap" id="extra_${idx}-preview-wrap" style="display:none"><span class="preview-delete" onclick="removeExtraImage(${idx})">×</span><img id="extra_${idx}-preview" class="preview-image" /></div><input type="text" id="extra_${idx}-label" placeholder="版本名称（可选）" style="width:100%;margin-top:6px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm)" />`;
  container.appendChild(div);
  w.extraNoteVersions.push({ idx, image: null });
}

export function removeExtraNoteVersion(idx: number): void {
  const div = document.getElementById('extra-note-' + idx);
  if (div) div.remove();
  w.extraNoteVersions = w.extraNoteVersions.filter((v: any) => v.idx !== idx);
}

export function removeExtraImage(idx: number): void {
  const ev = w.extraNoteVersions.find((v: any) => v.idx === idx);
  if (ev) ev.image = null;
  document.getElementById('extra_' + idx + '-preview-wrap')!.style.display = 'none';
}

export function takePhotoForExtra(target: string): void {
  const idx = parseInt(target.split('_')[1]);
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  const Camera = isNative ? w.Capacitor.Plugins.Camera : null;
  if (isNative && Camera) {
    Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' })
      .then((photo: any) => { const ev = w.extraNoteVersions.find((v: any) => v.idx === idx); if (ev) ev.image = photo.dataUrl; (document.getElementById('extra_' + idx + '-preview') as HTMLImageElement).src = photo.dataUrl; document.getElementById('extra_' + idx + '-preview-wrap')!.style.display = 'inline-block'; })
      .catch((e: any) => { if (e.message !== 'User cancelled photos app') w.showStatus('拍照失败: ' + e.message, 'error'); });
  } else {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    input.onchange = (e: any) => { if (e.target.files && e.target.files[0]) { const reader = new FileReader(); reader.onload = (ev2: any) => { const evObj = w.extraNoteVersions.find((v: any) => v.idx === idx); if (evObj) evObj.image = ev2.target.result; (document.getElementById('extra_' + idx + '-preview') as HTMLImageElement).src = ev2.target.result; document.getElementById('extra_' + idx + '-preview-wrap')!.style.display = 'inline-block'; }; reader.readAsDataURL(e.target.files[0]); } };
    input.click();
  }
}

export function pickFromGalleryForExtra(target: string): void {
  const idx = parseInt(target.split('_')[1]);
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  const Camera = isNative ? w.Capacitor.Plugins.Camera : null;
  if (isNative && Camera) {
    Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'PHOTOS' })
      .then((photo: any) => { const ev = w.extraNoteVersions.find((v: any) => v.idx === idx); if (ev) ev.image = photo.dataUrl; (document.getElementById('extra_' + idx + '-preview') as HTMLImageElement).src = photo.dataUrl; document.getElementById('extra_' + idx + '-preview-wrap')!.style.display = 'inline-block'; })
      .catch((e: any) => { if (e.message !== 'User cancelled photos app') w.showStatus('选择图片失败: ' + e.message, 'error'); });
  } else {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e: any) => { if (e.target.files && e.target.files[0]) { const reader = new FileReader(); reader.onload = (ev2: any) => { const evObj = w.extraNoteVersions.find((v: any) => v.idx === idx); if (evObj) evObj.image = ev2.target.result; (document.getElementById('extra_' + idx + '-preview') as HTMLImageElement).src = ev2.target.result; document.getElementById('extra_' + idx + '-preview-wrap')!.style.display = 'inline-block'; }; reader.readAsDataURL(e.target.files[0]); } };
    input.click();
  }
}
