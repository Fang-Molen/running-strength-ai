import { stampCN } from "@/lib/ui/activity-format";
import { useEffect, useState } from "react"
import { ONLINE_FEATURES, onlineFeatures, setOnlineFeature } from "@/lib/ui/online-features"
import { visionInfo, type VisionStatus } from "@/lib/vision/client"
/** 设置 → AI 服务与联网功能：逐项开关（默认全开，t473），同意时间；图片识别状态如实显示。 */
export function OnlineFeaturesSettings() {
  const [rec, setRec] = useState(() => onlineFeatures()), [vision, setVision] = useState<VisionStatus | null>(null)
  useEffect(() => { const c = new AbortController(); void visionInfo(c.signal).then(setVision); return () => c.abort() }, [])
  return <section className="home-card mt-3 space-y-2 p-4 text-sm" aria-label="联网功能" data-testid="online-features">
    <h3 className="font-bold">联网功能</h3>
    <p className="keep text-xs text-muted">已按你的要求全部开启（{stampCN(rec.consentAt, "ymd").slice(0, 10)} 记录同意）。密钥只在服务端。可逐项关闭。</p>
    {ONLINE_FEATURES.map(f => <label key={f.id} className="flex min-h-12 items-start gap-3 border-t border-line pt-2">
      <input type="checkbox" className="mt-1 size-5" aria-label={f.title} checked={rec.features[f.id] !== false} onChange={e => setRec(setOnlineFeature(f.id, e.target.checked))} />
      <span><b className="block">{f.title}</b><span className="keep block text-xs text-muted">{f.sends}</span></span>
    </label>)}
    <div className="border-t border-line pt-2"><b className="block">菜品照片 / 截图图片识别</b>
      <span className="keep block text-xs text-muted">{vision == null ? "检查中…" : vision.configured ? `已配置：${vision.provider ?? ""} ${vision.model ?? ""}，点识别才上传图片。` : "未配置：服务端缺 DEEPSEEK_API_KEY。营养标签、小票、体脂秤照片仍可用本机识字 + 联网整理。"}</span></div>
  </section>
}
