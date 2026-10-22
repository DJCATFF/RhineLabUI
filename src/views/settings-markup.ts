import { assetUrl } from "../asset-url";
import { audioSettingsMarkup } from "../audio-settings";
import { pwaSettingsMarkup } from "../pwa";
import { qualityMarkup } from "../quality-settings";
import type { RenderQuality } from "../render-quality";
import { themeSettingsMarkup } from "../theme-ui";

export type SettingsPreferences = {
  sound: boolean;
  music: boolean;
  soundVolume: number;
  musicVolume: number;
  reduced: boolean;
  superPerformance: boolean;
  rendering: RenderQuality;
  colorTheme: "light" | "dark";
};

export type SettingsMarkupOptions = {
  prefs: SettingsPreferences;
  /** Running as a Wallpaper Engine wallpaper: preferences cannot be persisted. */
  wallpaper: boolean;
  /** Extra rows contributed by the 3D workbench when it is active. */
  workbenchSettings: string;
  systemReducedMotion: boolean;
};

/** Reduced-motion note that is swapped in place when the toggle changes. */
export function motionSettingsMarkup(reduced: boolean, systemReducedMotion: boolean) {
  return `<div id="motion-preference-note" class="motion-preference-note"><p>${reduced
    ? `当前已减少动态效果。${systemReducedMotion ? "系统也请求减少动画，可仅为本站启用完整动效。" : "关闭上方开关可恢复完整动效。"}`
    : "当前使用完整动效。"}</p>${reduced ? '<button data-action="enable-motion">启用完整动效并重播 ↻</button>' : ""}</div>`;
}

/** Body of the settings modal. */
export function settingsMarkup({ prefs, wallpaper, workbenchSettings, systemReducedMotion }: SettingsMarkupOptions) {
  return `<h2>SYSTEM SETTINGS<small>终端偏好设置</small></h2><p class="settings-intro">JOYCE MOORE <span>·</span> SESSION AUTHORIZED</p>${wallpaper ? '<p class="wallpaper-settings-note">每次启动都会读取 Wallpaper Engine 中的设置。在此修改仅对当前运行生效，无法持久保存；如需保留，请在 Wallpaper Engine 的壁纸属性中调整。</p>' : ""}<div class="settings-list">${themeSettingsMarkup(prefs.colorTheme === "dark")}${!wallpaper ? `<label><div><strong>SUPER PERFORMANCE</strong><span>降低三维画质和渲染分辨率，保留完整动效；关闭后恢复原画质</span></div><input type="checkbox" data-pref="superPerformance" ${prefs.superPerformance ? "checked" : ""}/><i class="toggle"></i></label>` : ""}${workbenchSettings}${audioSettingsMarkup(prefs)}<label><div><strong>REDUCED MOTION</strong><span>跳过开机动画，简化选档、镜头和文字动效</span></div><input type="checkbox" data-pref="reduced" ${prefs.reduced ? "checked" : ""}/><i class="toggle"></i></label></div>${motionSettingsMarkup(prefs.reduced, systemReducedMotion)}${qualityMarkup(prefs.rendering)}${pwaSettingsMarkup()}<div class="settings-shortcuts">${wallpaper ? '<span>DESKTOP CONTROLS</span><p>拖动阵列或点击界面按钮浏览档案。桌面模式下，方向键与滚轮可能无法传入壁纸。</p>' : '<span>KEYBOARD CONTROLS</span><p><kbd>←</kbd><kbd>→</kbd> 切列 <kbd>↑</kbd><kbd>↓</kbd> 选档 <kbd>ENTER</kbd> 读取 <kbd>/</kbd> 检索 <kbd>ESC</kbd> 返回</p>'}</div><div class="settings-bottom">${!wallpaper && document.fullscreenEnabled ? '<button data-action="fullscreen">FULLSCREEN <span>↗</span></button>' : ''}<button data-action="restart">REINITIALIZE SYSTEM <span>↻</span></button></div><div class="modal-bottom"><span>ANALYSIS OS / 1.0 · 使用 MiSans 字体（小米） <a href="${assetUrl("fonts/MiSans-license.pdf")}" target="_blank" rel="noopener">字体许可</a></span><span>POWERED BY RHINE LAB</span></div>`;
}
