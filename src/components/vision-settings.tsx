import { useEffect, useState } from 'react';
import { visionInfo, visionStatusText, type VisionStatus } from '@/lib/vision/client';
/** v78：不再填访问码。只如实显示图片识别（视觉模型）是否已在服务端配置。 */
export function VisionSettings() {
  const [v, setV] = useState<VisionStatus | null>(null);
  useEffect(() => { const c = new AbortController(); void visionInfo(c.signal).then(setV); return () => c.abort(); }, []);
  return <p className="keep my-3 rounded-xl border border-line p-3 text-xs text-muted" data-testid="vision-status">图片识别：{visionStatusText(v)}</p>;
}
