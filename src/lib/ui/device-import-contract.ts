/** FRAME-04: local file preflight only. Never parse or persist training facts here. */
export type DeviceFileKind = 'fit' | 'tcx' | 'gpx' | 'csv' | 'apple-health-zip' | 'unsupported'
export type DeviceFilePreflight = {
  name: string
  sizeBytes: number
  kind: DeviceFileKind
  status: 'requires-parser' | 'unsupported' | 'too-large' | 'empty'
  message: string
}
/** Conservative cap for the *preview selection*, not a promise of parser support. */
export const MAX_PREVIEW_FILE_BYTES = 100 * 1024 * 1024
export function preflightDeviceFile(name: string, sizeBytes: number): DeviceFilePreflight {
  const safeName = name.trim().split(/[\\/]/).pop() || '未命名文件'
  const suffix = safeName.toLowerCase().split('.').pop()
  const kind: DeviceFileKind = suffix === 'fit' || suffix === 'tcx' || suffix === 'gpx' || suffix === 'csv'
    ? suffix : suffix === 'zip' ? 'apple-health-zip' : 'unsupported'
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return { name: safeName, sizeBytes, kind, status: 'empty', message: '文件为空或大小无效，未读取内容。' }
  if (sizeBytes > MAX_PREVIEW_FILE_BYTES) return { name: safeName, sizeBytes, kind, status: 'too-large', message: '文件超过本阶段预览限制，未读取内容。' }
  if (kind === 'unsupported') return { name: safeName, sizeBytes, kind, status: 'unsupported', message: '文件格式尚未纳入接入合同，未读取内容。' }
  return { name: safeName, sizeBytes, kind, status: 'requires-parser', message: '仅完成文件名、格式与大小检查；尚未解析、去重或导入。' }
}
