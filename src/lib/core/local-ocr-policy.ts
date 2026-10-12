/** BUILD 43: offline OCR admission and provenance policy; no network or training writes. */
export type OcrAvailability = 'NATIVE_LOCAL' | 'MANUAL_ONLY'
export function ocrAvailability(detector: unknown): OcrAvailability {
  return typeof detector === 'function' ? 'NATIVE_LOCAL' : 'MANUAL_ONLY'
}
export function validateOcrImage(mime: string, bytes: number): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return '不支持的图片格式'
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 6 * 1024 * 1024) return '图片大小无效或超过6MB'
  return null
}
export function mergeOcrText(existing: string, recognized: string): string {
  const incoming = recognized.trim()
  if (!incoming) return existing
  return [existing.trim(), incoming].filter(Boolean).join('\n')
}
export function ocrConfidenceLabel(): 'UNAVAILABLE' { return 'UNAVAILABLE' }
