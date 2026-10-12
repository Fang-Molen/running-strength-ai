export const APPEARANCE_KEY = "running-strength-appearance-v1";
export const WALLPAPERS = [
  { id: "plain", label: "简洁原色", description: "保持现有页面背景" },
  { id: "track", label: "跑道晨光", description: "暖色跑道氛围" },
  { id: "forest", label: "森林呼吸", description: "柔和绿色氛围" },
  { id: "night", label: "夜跑星空", description: "深蓝色氛围" },
] as const;
export type WallpaperId = (typeof WALLPAPERS)[number]["id"];
export function normalizeWallpaper(value: unknown): WallpaperId {
  return WALLPAPERS.find((item) => item.id === value)?.id ?? "plain";
}
export function readWallpaper(storage?: Pick<Storage, "getItem">): WallpaperId {
  try { return normalizeWallpaper(storage?.getItem(APPEARANCE_KEY)); } catch { return "plain"; }
}
export function writeWallpaper(storage: Pick<Storage, "setItem">, id: WallpaperId): boolean {
  try { storage.setItem(APPEARANCE_KEY, id); return true; } catch { return false; }
}


export const DISPLAY_MODE_KEY = "running-strength-display-mode-v1";
export type DisplayMode = "light" | "dark" | "system";
export function normalizeDisplayMode(value: unknown): DisplayMode {
  return value === "dark" || value === "system" ? value : "light";
}
export function readDisplayMode(storage?: Pick<Storage, "getItem">): DisplayMode {
  try { return normalizeDisplayMode(storage?.getItem(DISPLAY_MODE_KEY)); } catch { return "light"; }
}
export function writeDisplayMode(storage: Pick<Storage, "setItem">, mode: DisplayMode): boolean {
  try { storage.setItem(DISPLAY_MODE_KEY, mode); return true; } catch { return false; }
}
