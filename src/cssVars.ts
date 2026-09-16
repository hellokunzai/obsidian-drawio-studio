/**
 * 内联样式的唯一出口：只写「JS 算出来的值」，且一律落成 CSS 自定义属性。
 *
 * 为什么不用 `el.setCssProps()` / `setCssStyles()`：
 *   这两个 API 是 Obsidian 1.13 才加的，而本插件 `manifest.json#minAppVersion`
 *   是 1.4.0 —— 旧客户端上会直接抛 `setCssProps is not a function`。
 *   官方 d.ts 里它们没有 `@since` 标记，所以 `obsidianmd/no-unsupported-api`
 *   也查不出这条，只能靠这里守住。
 *
 * 为什么键名必须是 `--` 前缀：
 *   `obsidianmd/no-static-styles-assignment` 只放过两种写法 ——
 *   ① 右值是变量 / 模板串（不是字面量）；② 键名以 `--` 开头。
 *   写 `el.style.display = "none"` 这类「静态状态」应当改 CSS 类，
 *   本文件的两个 helper 只服务于「每帧都在变的尺寸 / 位移 / 动态背景」。
 *
 * 约定：`styles.css` 里用 `var(--x, 默认值)` 消费，「关闭」态走
 * `clearCssVars()` 摘掉声明，自动回落到 `var()` 的默认值 ——
 * 这样就不需要写 `= ""` / `= "none"` 这些字面量。
 */

type StyleTarget = HTMLElement | SVGElement;

/** 写入一批自定义属性（键名请带 `--` 前缀） */
export function setCssVars(el: StyleTarget, vars: Record<string, string>): void {
  for (const key in vars) {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      el.style.setProperty(key, vars[key]);
    }
  }
}

/** 摘掉一批自定义属性，让样式表里 `var(--x, 默认值)` 的默认值生效 */
export function clearCssVars(el: StyleTarget, ...keys: string[]): void {
  for (const key of keys) el.style.removeProperty(key);
}
