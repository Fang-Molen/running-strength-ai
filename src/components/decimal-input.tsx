import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { normalizeDecimal, parseDecimal } from "@/lib/ui/decimal";

/** Numeric field that keeps the raw text while focused ('6.' is not collapsed to '6'); reports parsed numbers; normalises on blur. */
export function DecimalInput({ value, onValue, integer, ...rest }: { value: number | null | undefined; onValue: (n: number | null) => void; integer?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const fmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : String(v));
  const [raw, setRaw] = useState(fmt(value)); const focused = useRef(false);
  useEffect(() => { if (!focused.current) setRaw(fmt(value)); }, [value]);
  return <input {...rest} type="text" inputMode={integer ? "numeric" : "decimal"} value={raw}
    onFocus={e => { focused.current = true; rest.onFocus?.(e); }}
    onBlur={e => { focused.current = false; setRaw(fmt(parseDecimal(raw))); rest.onBlur?.(e); }}
    onChange={e => { let s = normalizeDecimal(e.target.value); if (integer) s = s.replace(/\..*/, ""); setRaw(s); onValue(parseDecimal(s)); }} />;
}
