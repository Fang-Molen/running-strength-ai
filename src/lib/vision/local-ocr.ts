/** Local OCR: bounded, serialized worker; rejected initialization can be retried. */
type Worker = { recognize: (img: Blob) => Promise<{ data: { text: string } }>; terminate?: () => Promise<void> };
let worker: Promise<Worker> | null = null, script: Promise<void> | null = null, working = false;
function deadline<T>(p: Promise<T>, ms: number): Promise<T> { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('本地识字超时，可改用联网识别或手动输入。')), ms); p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); }); }
export async function ocr(file: Blob, onStatus: (s: string) => void): Promise<string> {
  if (working) throw Error('另一张图片正在本地识字，请稍后重试。'); working = true;
  try {
    const { prepareImage } = await import('./client'); const image = await prepareImage(file, 2000);
    const w = window as Window & { Tesseract?: { createWorker: (...args: unknown[]) => Promise<Worker> } };
    if (!w.Tesseract) {
      script ??= deadline(new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = '/vendor/tesseract/tesseract.min.js'; s.onload = () => ok(); s.onerror = () => { s.remove(); bad(Error('本地识字组件暂不可用，请联网重试。')); }; document.head.appendChild(s); }), 20000).catch(e => { script = null; throw e; }); await script;
    }
    if (!w.Tesseract) throw Error('本地识字组件未加载。');
    onStatus('正在本地读取文字，首次需下载识别组件…');
    worker ??= deadline(w.Tesseract.createWorker('chi_sim', 1, { workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract/', langPath: '/vendor/tesseract/', gzip: true, cacheMethod: 'write' }), 30000).catch(e => { worker = null; throw e; });
    const engine = await worker; const r = await deadline(engine.recognize(image), 40000); return r.data.text;
  } catch (e) { const old = worker; worker = null; void old?.then(w => w.terminate?.()).catch(() => {}); throw e; }
  finally { working = false; }
}
