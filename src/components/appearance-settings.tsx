import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { WALLPAPERS, type DisplayMode, type WallpaperId } from "@/lib/ui/appearance";
import type { FontScale } from "@/lib/ui/font-scale-v89";
import { PetVisibleToggle } from "@/components/pet/floating-pet";
import { petMoodSrc, type PetRoleId } from "@/components/pet/config";
import { CHARACTER_THEMES, type CharacterThemeId } from "@/lib/ui/character-themes";
import "./appearance-settings.css";

type Props = {
  displayMode: DisplayMode;
  fontScale: FontScale;
  wallpaper: WallpaperId;
  characterTheme: CharacterThemeId;
  onDisplayMode: (value: DisplayMode) => void;
  onFontScale: (value: FontScale) => void;
  onWallpaper: (value: WallpaperId) => void;
  onCharacterTheme: (value: CharacterThemeId) => void;
};

type ThemeCard = { id: CharacterThemeId; role: PetRoleId; name: string; subtitle: string; swatches: readonly string[] };
/** 统一角色卡：经典（电脑人）排第一，后面是七套主题角色。图是该角色 happy 表情（透明底），放在主题浅色渐变底上。 */
const CLASSIC_CARD: ThemeCard = { id: "classic", role: "robot", name: "经典·电脑人", subtitle: "原版方坤，稳定清晰", swatches: ["#A8420A", "#F7F6F2", "#121314"] };
export const THEME_CARDS: readonly ThemeCard[] = [CLASSIC_CARD, ...CHARACTER_THEMES.map(t => ({ id: t.id as CharacterThemeId, role: t.id as PetRoleId, name: t.name, subtitle: t.subtitle, swatches: t.swatches }))];

/** Presentation only. The parent keeps the existing persistence and theme lifecycle. */
export function AppearanceSettings({ displayMode, fontScale, wallpaper, characterTheme, onDisplayMode, onFontScale, onWallpaper, onCharacterTheme }: Props) {
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

    <div className="fk-appearance-group" role="group" aria-label="方坤角色主题">
      <div className="fk-character-theme-head">
        <div><h3>方坤角色主题</h3><p>经典电脑人加七位角色，配色、形象和桌宠一键切换</p></div>
        <button type="button" className="fk-theme-classic" aria-pressed={characterTheme === "classic"} onClick={() => onCharacterTheme("classic")}>恢复经典</button>
      </div>
      <div className="fk-character-theme-grid">
        {THEME_CARDS.map(card => {
          const selected = characterTheme === card.id;
          return <button
            key={card.id} type="button" className="fk-character-theme-option" data-theme-card={card.id}
            aria-label={card.id === "classic" ? "选择经典主题（电脑人）" : `选择${card.name}主题`} aria-pressed={selected}
            style={{ "--card-accent": card.swatches[0], "--card-bg": card.swatches[1] } as CSSProperties}
            onClick={() => onCharacterTheme(card.id)}>
            <span className="fk-character-theme-art">
              <img src={petMoodSrc(card.role, "happy")} alt="" loading="lazy" decoding="async" draggable={false} />
              {selected ? <span className="fk-character-theme-check" aria-hidden="true"><Check /></span> : null}
            </span>
            <span className="fk-character-theme-title">{card.name}</span>
            <span className="fk-character-theme-subtitle">{selected ? "使用中 · " : ""}{card.subtitle}</span>
            <span className="fk-character-theme-swatches" aria-hidden="true">{card.swatches.map((hex, i) => <i key={i} style={{ backgroundColor: hex }} />)}</span>
          </button>;
        })}
      </div>
      <PetVisibleToggle />
      <p className="fk-theme-note">只更换外观。训练、健康、设备同步、AI判断和历史记录不受影响。</p>
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
