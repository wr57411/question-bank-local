/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal } from './common';
const w = window as any;

// ========== 待处理照片 ==========

let currentProcessPhotoId: string | null = null;
let currentBatchGroupId: string | null = null;

export async function showPendingPhotosTab(): Promise<void> {
  w.showTab('pending-photos', document.querySelector('.tab[onclick*="pending-photos"]'));
  await loadPendingPhotos();
}

export async function loadPendingPhotos(): Promise<void> {
  const groups = await w.dbGetPendingPhotosGrouped();
  const c = document.getElementById("pending-photos-list")!;
  const countBadge = document.getElementById("pending-photos-count")!;
  const allPhotos = await w.dbGetPendingPhotos();

  if (allPhotos.length > 0) {
    countBadge.textContent = String(allPhotos.length);
    countBadge.style.display = "inline-block";
  } else {
    countBadge.style.display = "none";
  }

  if (!allPhotos.length) {
    c.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:30px">暂无待处理照片<br><small>长按 App 图标选择「快速拍照」</small></div>';
    return;
  }

  c.replaceChildren();
  const groupKeys = Object.keys(groups);

  groupKeys.forEach(gid => {
    const photos = groups[gid];
    const isUngrouped = gid === "未分组";
    const label = isUngrouped ? "📷 未分组" : "📌 " + gid.replace("group_", "第") + "组";

    // 组标题
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:10px 0 6px;border-bottom:2px solid var(--border)";
    const title = document.createElement("div");
    title.textContent = label + " (" + photos.length + "张)";
    title.style.cssText = "font-size:14px;font-weight:700;color:var(--text)";
    header.appendChild(title);

    if (!isUngrouped && photos.length > 1) {
      const batchBtn = document.createElement("button");
      batchBtn.textContent = "批量处理";
      batchBtn.style.cssText = "padding:6px 14px;font-size:12px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer";
      batchBtn.onclick = () => openBatchProcessModal(gid);
      header.appendChild(batchBtn);
    }
    c.appendChild(header);

    // 照片列表
    const list = document.createElement("div");
    list.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;padding:8px 0";
    photos.forEach((p: any) => {
      const item = document.createElement("div");
      item.style.cssText = "position:relative;cursor:pointer";
      item.onclick = () => openProcessPhotoModal(p.id);
      const img = document.createElement("img");
      img.src = p.image_url;
      img.style.cssText = "width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;border:1px solid var(--border-light)";
      const del = document.createElement("span");
      del.textContent = "×";
      del.style.cssText = "position:absolute;top:-4px;right:-4px;width:20px;height:20px;background:var(--danger);color:#fff;border-radius:50%;font-size:12px;display:flex;align-items:center;justify-content:center;cursor:pointer";
      del.onclick = (e) => { e.stopPropagation(); deletePendingPhotoById(p.id); };
      item.append(img, del);
      list.appendChild(item);
    });
    c.appendChild(list);
  });
}

export async function openProcessPhotoModal(photoId: string): Promise<void> {
  currentProcessPhotoId = photoId;
  currentBatchGroupId = null;
  const photo = await w.dbPendingPhotos.getItem(photoId);
  if (!photo) return;

  (document.getElementById("process-photo-img") as HTMLImageElement).src = photo.image_url;
  document.getElementById("process-photo-img")!.style.display = "block";
  (document.getElementById("process-photo-label") as HTMLInputElement).value = "";

  const qSelect = document.getElementById("process-photo-question") as HTMLSelectElement;
  qSelect.innerHTML = '<option value="">-- 新建题目 --</option>';
  w.allQuestions.filter((q: any) => !q.deleted_at).forEach((q: any) => {
    const opt = document.createElement("option");
    opt.value = q.id;
    opt.textContent = (q.semantic_summary || q.user_comment || q.id.substring(0, 8));
    qSelect.appendChild(opt);
  });

  const tSelect = document.getElementById("process-photo-tags") as HTMLSelectElement;
  tSelect.innerHTML = "";
  w.allTags.forEach((t: any) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    tSelect.appendChild(opt);
  });

  openModal("process-photo-modal");
}

export function openBatchProcessModal(groupId: string): void {
  currentBatchGroupId = groupId;
  (document.getElementById("process-photo-label") as HTMLInputElement).value = "";
  document.getElementById("process-photo-img")!.style.display = "none";

  const qSelect = document.getElementById("process-photo-question") as HTMLSelectElement;
  qSelect.innerHTML = '<option value="">-- 新建题目 --</option>';
  w.allQuestions.filter((q: any) => !q.deleted_at).forEach((q: any) => {
    const opt = document.createElement("option");
    opt.value = q.id;
    opt.textContent = (q.semantic_summary || q.user_comment || q.id.substring(0, 8));
    qSelect.appendChild(opt);
  });

  const tSelect = document.getElementById("process-photo-tags") as HTMLSelectElement;
  tSelect.innerHTML = "";
  w.allTags.forEach((t: any) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    tSelect.appendChild(opt);
  });

  openModal("process-photo-modal");
}

export async function confirmProcessPhoto(): Promise<void> {
  if (currentBatchGroupId) {
    // 批量处理模式
    const questionId = (document.getElementById("process-photo-question") as HTMLSelectElement).value;
    const label = (document.getElementById("process-photo-label") as HTMLInputElement).value.trim();
    const tags = Array.from((document.getElementById("process-photo-tags") as HTMLSelectElement).selectedOptions).map(o => o.value);

    const groups = await w.dbGetPendingPhotosGrouped();
    const photos = groups[currentBatchGroupId] || [];

    if (questionId) {
      for (let i = 0; i < photos.length; i++) {
        const v = label ? label + " v" + (i + 1) : "笔记 v" + (i + 1);
        await w.dbAddQuestionNote(questionId, photos[i].image_url, v, "");
        await w.dbMarkPendingPhotoProcessed(photos[i].id, questionId);
      }
      if (tags.length) {
        for (const tagId of tags) await w.dbAddTagToQuestion(questionId, tagId);
      }
    } else {
      const newQ = await w.dbCreateQuestion(photos[0].image_url, null, tags, 0, null, []);
      for (let i = 0; i < photos.length; i++) {
        const v = label ? label + " v" + (i + 1) : "笔记 v" + (i + 1);
        await w.dbAddQuestionNote(newQ.id, photos[i].image_url, v, "");
        await w.dbMarkPendingPhotoProcessed(photos[i].id, newQ.id);
      }
    }

    currentBatchGroupId = null;
    closeProcessPhotoModal();
    await loadPendingPhotos();
    await w.loadQuestions();
    w.showStatus("批量处理完成", "success");
    return;
  }

  // 单张处理模式
  if (!currentProcessPhotoId) return;
  const photo = await w.dbPendingPhotos.getItem(currentProcessPhotoId);
  if (!photo) return;

  const questionId = (document.getElementById("process-photo-question") as HTMLSelectElement).value;
  const label = (document.getElementById("process-photo-label") as HTMLInputElement).value.trim() || "笔记 v1";
  const tags = Array.from((document.getElementById("process-photo-tags") as HTMLSelectElement).selectedOptions).map(o => o.value);

  if (questionId) {
    await w.dbAddQuestionNote(questionId, photo.image_url, label, "");
    if (tags.length) {
      for (const tagId of tags) await w.dbAddTagToQuestion(questionId, tagId);
    }
  } else {
    const newQ = await w.dbCreateQuestion(photo.image_url, null, tags, 0, null, []);
    await w.dbAddQuestionNote(newQ.id, photo.image_url, label, "");
  }

  await w.dbMarkPendingPhotoProcessed(currentProcessPhotoId, questionId || "new");
  closeProcessPhotoModal();
  await loadPendingPhotos();
  await w.loadQuestions();
  w.showStatus("照片已处理", "success");
}

export function closeProcessPhotoModal(): void {
  closeModal("process-photo-modal");
  currentProcessPhotoId = null;
}

export async function deletePendingPhoto(): Promise<void> {
  if (!currentProcessPhotoId) return;
  if (!confirm("确定删除这张照片？")) return;
  await w.dbDeletePendingPhoto(currentProcessPhotoId);
  closeProcessPhotoModal();
  await loadPendingPhotos();
  w.showStatus("照片已删除", "success");
}

export async function deletePendingPhotoById(photoId: string): Promise<void> {
  if (!confirm("确定删除这张照片？")) return;
  await w.dbDeletePendingPhoto(photoId);
  await loadPendingPhotos();
  w.showStatus("照片已删除", "success");
}

export function closePendingPhotosModal(): void {
  closeModal("pending-photos-modal");
}
