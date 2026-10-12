/** Local-only CSV inspection. No storage writes or inferred training facts. */
export type CsvPreview = { headers: string[]; rows: string[][]; totalRows: number; warnings: string[] }
export function parseCsvPreview(text: string, maxRows = 20): CsvPreview {
  if (text.length > 2_000_000) throw new Error('CSV 文本超过 2 MB 预览上限')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v.trim())) rows.push(row)
      row = []
    } else field += ch
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  row.push(field)
  if (row.some(v => v.trim())) rows.push(row)
  const headers = (rows.shift() ?? []).map((v, i) => i === 0 ? v.replace(/^\uFEFF/, '').trim() : v.trim())
  if (!headers.length || !headers.some(Boolean)) throw new Error('CSV 缺少表头')
  const warnings: string[] = []
  if (rows.some(r => r.length !== headers.length)) warnings.push('部分行列数与表头不一致，请检查原始文件')
  if (headers.some(h => !h)) warnings.push('存在空列名')
  return { headers, rows: rows.slice(0, Math.max(0, maxRows)), totalRows: rows.length, warnings }
}
