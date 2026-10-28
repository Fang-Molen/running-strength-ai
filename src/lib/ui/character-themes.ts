/** Original Fangkun visual themes; independent from training/health data. */
export const CHARACTER_THEME_KEY = "fk-character-theme-v1";
export const CHARACTER_THEMES = [
  { id: "chiyan", name: "赤焰·逐风", subtitle: "疾速与行动", symbol: "焰", tagline: "向目标再迈一步", avatar: "/assets/fangkun/themes/chiyan-avatar.webp", swatches: ["#AA3427", "#FFF8F5", "#2B201E"] },
  { id: "xuanjin", name: "玄金·智衡", subtitle: "理性与数据", symbol: "衡", tagline: "用证据寻找更好的答案", avatar: "/assets/fangkun/themes/xuanjin-avatar.webp", swatches: ["#84621A", "#FBF8F0", "#29251D"] },
  { id: "lingyue", name: "灵跃·同行", subtitle: "陪伴与鼓励", symbol: "跃", tagline: "认真训练，也好好生活", avatar: "/assets/fangkun/themes/lingyue-avatar.webp", swatches: ["#A53572", "#FFF7FB", "#30232C"] },
  { id: "qingye", name: "青野·长行", subtitle: "耐力与探索", symbol: "野", tagline: "走得稳，也走得远", avatar: "/assets/fangkun/themes/qingye-avatar.webp", swatches: ["#287347", "#F5F9F3", "#1F2D24"] },
  { id: "anlan", name: "暗澜·突破", subtitle: "专注与突破", symbol: "澜", tagline: "突破来自每一次专注", avatar: "/assets/fangkun/themes/anlan-avatar.webp", swatches: ["#6844B7", "#F8F6FF", "#252139"] },
  { id: "liuguang", name: "流光·自在", subtitle: "轻盈与自由", symbol: "光", tagline: "在变化中找到自己的节奏", avatar: "/assets/fangkun/themes/liuguang-avatar.webp", swatches: ["#176FA8", "#F3FAFF", "#1D2D3B"] },
  { id: "shanyue", name: "山月·守衡", subtitle: "恢复与节律", symbol: "月", tagline: "懂得恢复，才能走得更远", avatar: "/assets/fangkun/themes/shanyue-avatar.webp", swatches: ["#456C69", "#F6F8F5", "#24302F"] },
] as const;
export type CharacterThemeId = "classic" | (typeof CHARACTER_THEMES)[number]["id"];
export const CHARACTER_THEME_BACKGROUND: Record<Exclude<CharacterThemeId, "classic">, {light:string;dark:string}> = {
  chiyan: {light:"#FFF8F5",dark:"#160F12"},
  xuanjin: {light:"#FBF8F0",dark:"#15130F"},
  lingyue: {light:"#FFF7FB",dark:"#1E1420"},
  qingye: {light:"#F5F9F3",dark:"#101B15"},
  anlan: {light:"#F8F6FF",dark:"#141121"},
  liuguang: {light:"#F3FAFF",dark:"#0E1A27"},
  shanyue: {light:"#F6F8F5",dark:"#121A1A"},
};
export function normalizeCharacterTheme(value: unknown): CharacterThemeId {
  return value === "classic" || CHARACTER_THEMES.some(theme => theme.id === value) ? value as CharacterThemeId : "classic";
}
type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;
export function readCharacterTheme(store?: ReadStore): CharacterThemeId {
  try { return normalizeCharacterTheme(store?.getItem(CHARACTER_THEME_KEY)); } catch { return "classic"; }
}
export function writeCharacterTheme(store: WriteStore, id: CharacterThemeId): boolean {
  try { store.setItem(CHARACTER_THEME_KEY, normalizeCharacterTheme(id)); return true; } catch { return false; }
}
export function getCharacterTheme(id: CharacterThemeId) {
  return CHARACTER_THEMES.find(theme => theme.id === id) ?? null;
}
