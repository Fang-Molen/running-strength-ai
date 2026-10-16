/** 饮食照片只存本机 IndexedDB（fangkun-food-photos），不上传。 */
const DB = "fangkun-food-photos";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function shrink(file: File, max = 900): Promise<Blob> {
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.8));
}
export async function savePhoto(id: string, blob: Blob): Promise<void> {
  const db = await open(); await new Promise<void>((res, rej) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").put(blob, id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
