import { useEffect, useState } from 'react';
import { visionInfo, type VisionStatus } from '@/lib/vision/client';
/** v78：不再填访问码。只如实显示图片识别（视觉模型）是否已在服务端配置。 */
export function VisionSettings() {
  const [v, setV] = useState<VisionStatus | null>(null);
  useEffect(() => { const c = new AbortController(); void visionInfo(c.signal).then(setV); return () => c.abort(); }, []);
  return <p className="keep my-3 rounded-xl border border-line p-3 text-xs text-muted" data-testid="vision-status">{v == null ? '图片识别：检查中…' : v.configured ? `图片识别已配置（${v.provider ?? ''} ${v.model ?? ''}），点识别才上传所选图片。` : '图片识别未配置（服务端缺 DEEPSEEK_API_KEY），截图会先用本机识字再提取。'}</p>;
}
