import { Check } from "lucide-react";
import { WALLPAPERS, type DisplayMode, type WallpaperId } from "@/lib/ui/appearance";
import type { FontScale } from "@/lib/ui/font-scale-v89";
import "./appearance-settings.css";

type Props = {
  displayMode: DisplayMode;
  fontScale: FontScale;
  wallpaper: WallpaperId;
  onDisplayMode: (value: DisplayMode) => void;
  onFontScale: (value: FontScale) => void;
  onWallpaper: (value: WallpaperId) => void;
};

/** Presentation only. The parent keeps the existing persistence and theme lifecycle. */
export function AppearanceSettings({ displayMode, fontScale, wallpaper, onDisplayMode, onFontScale, onWallpaper }: Props) {
  return <section id="settings-theme" className="home-card fk-appearance-settings" aria-label="界面与壁纸设置">
    <div className="fk-appearance-group" role="group" aria-label="显示模式">
      <h3>显示模式</h3>
      <div className="fk-appearance-segments">
        {([["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]] as const).map(([id, label]) =>
          <button key={id} type="button" className="fk-appearance-choice" aria-pressed={displayMode === id} onClick={() => onDisplayMode(id)}>
            {displayMode === id ? <Check aria-hidden="true" /> : null}<span>{label}</span>
          </button>)}
      </div>
    </div>

    <div className="fk-appearance-group" role="group" aria-label="全局字体大小">
      <h3>文字大小</h3>
      <div className="fk-appearance-segments">
        {([["standard", "标准"], ["large", "大"], ["extra", "特大"]] as const).map(([id, label]) =>
          <button key={id} type="button" className="fk-appearance-choice" aria-pressed={fontScale === id} onClick={() => onFontScale(id)}>
            {fontScale === id ? <Check aria-hidden="true" /> : null}<span>{label}</span>
          </button>)}
      </div>
      <div className="fk-appearance-preview" data-wallpaper={wallpaper} aria-label="当前外观预览">
        <span className="fk-appearance-preview-label">预览</span>
        <div className="fk-appearance-preview-card"><strong>清楚看到每一次进步</strong><p>训练、记录与方坤</p></div>
      </div>
    </div>

    <div className="fk-appearance-group" role="group" aria-label="壁纸选择">
      <h3>背景风格</h3>
      <div className="fk-wallpaper-grid">
        {WALLPAPERS.map(item => <button key={item.id} type="button" className="fk-wallpaper-option" aria-label={item.label} aria-pressed={wallpaper === item.id} onClick={() => onWallpaper(item.id)}>
          <span className="fk-wallpaper-visual" data-wallpaper={item.id} aria-hidden="true"><i /><span><b /><em /></span></span>
          <span className="fk-wallpaper-caption"><span>{item.label}</span>{wallpaper === item.id ? <Check aria-hidden="true" /> : null}</span>
        </button>)}
      </div>
    </div>
  </section>;
}
