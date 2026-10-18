/** t441: decimal input helpers. Accept '.', '，', ',', '。' and full-width digits; keep the raw string while typing ('6.' stays '6.'). */
export function normalizeDecimal(raw: string, maxLen = 10): string {
  let s = String(raw ?? "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[，,。．、]/g, ".").replace(/[^\d.]/g, "");
  const i = s.indexOf("."); if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
  return s.slice(0, maxLen);
}
export function parseDecimal(raw: string | number | null | undefined): number | null {
  if (raw == null) return null; if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = normalizeDecimal(raw); if (!s || s === ".") return null; const n = Number(s.endsWith(".") ? s.slice(0, -1) : s);
  return Number.isFinite(n) ? n : null;
}
