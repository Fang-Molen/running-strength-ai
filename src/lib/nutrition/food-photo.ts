/** Photos remain local in IndexedDB; network recognition is a separate explicit action. */
import { prepareImage } from '../vision/client';
const DB = "fangkun-food-photos";
function open(): Promise<IDBDatabase> {
 return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(Error("照片存储被其他页面占用，请关闭后重试")); });
}
export async function shrink(file: File, max = 900): Promise<Blob> { return prepareImage(file, max); }
async function transaction(id: string, blob?: Blob): Promise<void> {
 const db = await open();
 try { await new Promise<void>((res, rej) => { const t = db.transaction("photos", "readwrite"); const store = t.objectStore("photos"); if (blob) store.put(blob, id); else store.delete(id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || Error("照片保存中断")); }); } finally { db.close(); }
}
export const savePhoto = (id: string, blob: Blob) => transaction(id, blob);
export const deletePhoto = (id: string) => transaction(id);
export async function readPhoto(id: string): Promise<Blob | null> {
 const db = await open(); try { return await new Promise((resolve, reject) => { const r = db.transaction('photos', 'readonly').objectStore('photos').get(id); r.onsuccess = () => resolve(r.result instanceof Blob ? r.result : null); r.onerror = () => reject(r.error); }); } finally { db.close(); }
}
