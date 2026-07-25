import { dbPendingPhotos, generateId, nowIso } from './stores';
import type { PendingPhoto } from '../types';

export async function dbGetPendingPhotos(): Promise<PendingPhoto[]> {
  const result: PendingPhoto[] = [];
  await dbPendingPhotos.iterate((v: unknown) => {
    if (v) result.push(v as PendingPhoto);
  });
  return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function dbGetPendingPhotosGrouped(): Promise<Map<string, PendingPhoto[]>> {
  const photos = await dbGetPendingPhotos();
  const groups = new Map<string, PendingPhoto[]>();
  for (const photo of photos) {
    const gid = photo.group_id || 'default';
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid)!.push(photo);
  }
  return groups;
}

export async function dbAddPendingPhoto(imageUrl: string, groupId: string): Promise<PendingPhoto> {
  const id = generateId();
  const photo: PendingPhoto = { id, image_url: imageUrl, group_id: groupId || generateId(), processed: false, question_id: null, created_at: nowIso() };
  await dbPendingPhotos.setItem(id, photo);
  return photo;
}

export async function dbMarkPendingPhotoProcessed(photoId: string, questionId: string): Promise<void> {
  const photo = await dbPendingPhotos.getItem(photoId) as PendingPhoto | null;
  if (!photo) return;
  await dbPendingPhotos.setItem(photoId, { ...photo, processed: true, question_id: questionId });
}

export async function dbBatchMarkGroupProcessed(groupId: string, questionId: string): Promise<void> {
  const keys: string[] = [];
  await dbPendingPhotos.iterate((v: unknown, key: string) => {
    const photo = v as PendingPhoto;
    if (photo && photo.group_id === groupId && !photo.processed) keys.push(key);
  });
  for (const key of keys) {
    const photo = await dbPendingPhotos.getItem(key) as PendingPhoto;
    await dbPendingPhotos.setItem(key, { ...photo, processed: true, question_id: questionId });
  }
}

export async function dbDeletePendingPhoto(photoId: string): Promise<void> {
  await dbPendingPhotos.removeItem(photoId);
}

export async function dbGetPendingPhotoCount(): Promise<number> {
  let count = 0;
  await dbPendingPhotos.iterate((v: unknown) => {
    if (v && !(v as PendingPhoto).processed) count++;
  });
  return count;
}
