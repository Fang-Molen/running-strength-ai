/** BUILD 44: feature detection, not browser-name inference. No external calls. */
export type BrowserCapabilities = {secureContext:boolean; fileUpload:boolean; cameraCaptureHint:boolean; nativeTextDetector:boolean; imageBitmap:boolean; indexedDb:boolean; serviceWorker:boolean; wasm:boolean; webCrypto:boolean; installPrompt:boolean}
export function browserCapabilities(env: {window?:any; navigator?:any; global?:any} = {}):BrowserCapabilities {
 const w=env.window??(typeof window!=='undefined'?window:undefined)
 const n=env.navigator??(typeof navigator!=='undefined'?navigator:undefined)
 const g=env.global??globalThis
 return {secureContext:w?.isSecureContext===true,fileUpload:!!w?.File && !!w?.document?.createElement,cameraCaptureHint:!!w?.document?.createElement && !!n?.mediaDevices?.getUserMedia,nativeTextDetector:typeof w?.TextDetector==='function',imageBitmap:typeof g?.createImageBitmap==='function',indexedDb:!!w?.indexedDB,serviceWorker:!!n?.serviceWorker,wasm:typeof g?.WebAssembly==='object',webCrypto:!!g?.crypto?.subtle,installPrompt:false}
}
export function imageEntryMode(c:BrowserCapabilities):'LOCAL_OCR'|'MANUAL_IMAGE'|'TEXT_ONLY' {return c.fileUpload?(c.nativeTextDetector&&c.imageBitmap?'LOCAL_OCR':'MANUAL_IMAGE'):'TEXT_ONLY'}
