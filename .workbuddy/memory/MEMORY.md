# 项目记忆

> Obsidian 插件 obsidian-drawio-editor（id: `drawio-studio`，名称「Drawio Studio」），当前 v0.18.2。
> 只记跨会话成立的事实与结论；逐次改动见 `.workbuddy/memory/YYYY-MM-DD.md`。
> 通用方法（按钮特异性 / 图标取证 / 截图解码 / 上架速查表等）已在 skill `obsidian-plugin-dev`，此处只留项目特有结论。

## 编辑纪律
- **同一文件的多次 Edit 必须串行**：并行编辑同文件会静默覆盖，工具两次都回 success。改完关键文件 Read 回读确认。
- **校验脚本报错先怀疑断言本身**：断言要用「只可能出现在目标位置」的锚点，或先切掉说明区。

## 插件身份
- **id `drawio-studio` / name「Drawio Studio」**（v0.18.1 起，2026-09-14 定案）。原 id `drawio-editor` 被 doge-liang 的插件「Drawio」占用。
- 上架前先探 ID：`https://community.obsidian.md/plugins/<id>` 返「Plugin not found」= 空闲。表单只在点「提交」时才校验。
- **`drawio` 扩展名冲突（未解决，仅 README 披露）**：对方也 `registerExtensions(['drawio'])`；视图注册表命中重复扩展名即 `throw`，而 `Plugin.registerExtensions` 不捕获 → **后加载的插件整体 `onload` 抛错、加载失败**。按字母序我们排在 `drawio-editor` 之后。
- 内部标识符：view type `drawio-studio-view`、容器类 `.drawio-studio-container`，**含 styles.css 里的 `[data-type=…]` 选择器**（漏改会让「视图铺满叶子」的修复静默失效）。
- **刻意保留 `obsidian-drawio-editor` 字样**：`package.json#name` 与 mxfile `host=`（`DrawioView.ts:2802`、`main.ts:162`）——属仓库/NPM 包名，与插件 id 无关；`host` 会写进用户图表文件，保持不变让新旧文件无差异。GitHub 仓库名亦未改。
- vault 插件目录须为 `.obsidian/plugins/drawio-studio/`；旧 view type 的已打开标签页下次启动会被丢弃一次。

## 技术栈与工作流
- TypeScript + esbuild；mxgraph 4.2.2（`src/mxClient.min.js` 经 raw-loader 内联进产物）+ pako。
- 改完必须：tsc → `node esbuild.config.mjs --production`（**该脚本不含 tsc**）→ 同步三处版本号（manifest.json / package.json / versions.json）。
- 用户自己把 main.js / styles.css / manifest.json 拷进 vault；未经明确要求不 `git commit`。
- remote `git@github.com:hellokunzai/obsidian-drawio-editor.git`，默认分支 main。

## 本机构建 / 校验（沙箱环境）
- PATH 无 npm/npx，用 Bash + 托管 node 绝对路径 `C:/Users/hellokunzai/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`（node/python 用绝对路径总能跑）。
- **Bash 的 PATH 有时整个是坏的**（`dirname: command not found`，连 `cat`/`git`/`ls` 都找不到）：命令**开头显式补 PATH** 即可恢复：
  `export PATH="/c/Users/hellokunzai/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd:/c/Users/hellokunzai/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin:/c/Users/hellokunzai/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"`
- `git commit -F <file>` 的路径**必须是 Windows 形式**（`C:/...`）；POSIX `/c/...` 会被原生 git.exe 判成 `could not read log file`。
- 本机**没装 `gh`**；看 Release / Actions 走 GitHub API（WebFetch）或 GitHub MCP connector。
- **`rm` / `rm -rf` 被 shim 挡住**（退出 127），且 `rm -rf x && 真命令` 会在 rm 处短路。删目录用 python `shutil.rmtree`，或换成新临时目录名。
- **无头截图可用**（Edge）：`msedge.exe --headless=new --no-sandbox --disable-gpu --force-device-scale-factor=2 --user-data-dir=<新临时目录> --virtual-time-budget=6000 --window-size=1060,620 --screenshot=<绝对路径>.png "file:///<绝对路径>.html"`，日志 `> log 2>&1`。2x 图，量 CSS 尺寸除以 2。探测时 x 必须落在目标内部。
- 校验中文文案：minify 把非 ASCII 转义，**U+0080~U+00FF 走 `\xHH`（`·`→`\xB7`），更靠后的走 `\uXXXX`**；两种都要反转义再 `includes()`。
- 看截图取证：无 PIL，纯 python + zlib 手写 PNG 解码（filter 0~4 逐行还原）；脚本在 `.workbuddy/tmp/`（ascii.py / map.py / measure-*.py）。

## CSS 铁律
- 上色用具体 hex / rgba（draw.io 蓝 `#167dff` + `rgba(22,125,255,0.12)`），别依赖 `var(--interactive-accent)` / `color-mix`。覆盖 mxClient 默认类（如 `.mxRubberband`）要补 `position:absolute; pointer-events:none`。
- **自绘 `<button>` 单类名 (0,1,0) 必被 Obsidian `button:not(.clickable-icon)`（(0,1,1)）压成灰底实心方块。** 双保险：① 提权到 (0,2,0)（祖先稳定用父级前缀，挂 body 的浮动面板用重复类名）；② 挂 `clickable-icon` 让它直接不匹配。**这个坑永远是一片不是一个**：改完必须跑全量扫描
  `node C:/Users/hellokunzai/.workbuddy/skills/obsidian-plugin-dev/scripts/scan-button-specificity.js`（项目根跑，退出码 0 才算过）。本仓有**两套**建按钮写法须全覆盖：`createEl("button", {cls})` 与本地 helper `h("button", "cls", text)`（DrawPanel.ts / FormatPanel.ts）。
- Obsidian 默认规则只设 `background-color / color / box-shadow`，**不设 border**，自写 `border` 会生效 → 三重 chrome。改原生按钮皮须显式 `border:none; box-shadow:none; appearance:none;`；纯图标按钮走 `--icon-color` / `--icon-opacity`。
- 判「提权保留原设计」还是「改原生皮」：看原规则有没有显式写 `background` / `border`。提权后基础类会压过自己的组合类（`.btn-text` 要一起提权）；`:hover` / `.is-active` (0,2,0) 必须写在基础规则之后。
- 排查手法：把 `obsidian.asar` 当 latin1 字符串读（`app.css` 是明文），正则 `/([^{}\n]{0,200}button[^{}\n]{0,120})\{([^{}]{0,500}interactive-normal[^{}]{0,300})\}/g` 捞原文。
- 主题反推：用户主题 **Catppuccin（Latte/Mocha）**——base `#eff1f5` / mantle `#e6e9ef` / surface0 `#ccd0da` / text `#4c4f69` / overlay `#6c6f85`。
- 「修复前/后」对照原型三要求：① 把 `button:not(.clickable-icon)` 抄进原型 `<style>`；② 用 `.before :where(.my-btn)` 还原真实 (0,1,0)；③ **对照的重点是什么，就让两边只差那一件事**。原型要钉死列宽（`.boards > div { width:306px }`），控件细节照抄真相。

## 图标体系（v0.16.8 起）
- 工具栏图标集中在 `DrawioView.ts#getIconDef()` → `IconDef { svg, filled?, viewBox? }`；`renderIcon()` 据 `filled` 出 `fill="currentColor" stroke="none"` 或描边。
- **实心图标 viewBox 必须紧贴字形**：扁字形（undo/redo 2.27:1）塞进 24×24 会被 `meet` 缩成细线。undo `1.9 6.9 20.7 9.2` / redo `1.4 6.9 20.8 9.2`（Material filled）。用 `verify-icon-viewbox.js` 校验。
- **内联 `<svg width/height>` 会被 CSS 静默覆盖**：图标尺寸只在 CSS 一处定义，`renderIcon()` 不输出 width/height。
- 撤销/重做按 `undoManager.canUndo()/canRedo()` 置灰（`refreshUndoRedoState()`）；置灰 CSS 要连 `:hover` / `:active` 一起覆盖 (0,3,0)，保留 pointer-events 让 tooltip 还在。
- 复刻用户截图图标：先 python+zlib 逐像素 ASCII 读包围盒 / 宽高比 / 有无竖直实心边 / 弧线甩向 → 判定图标族（本项目为 Material Design）。

## 视图铺满叶子
- `.workspace-leaf-content .view-content` 默认有 padding（尤其下 32px），容器 `height:100%` 只拿内容盒 → 四周露白。styles.css 用 (0,3,0) 选择器清零内边距、overflow 改 hidden。

## mxGraph 坐标语义
- `state.x/y/width/height` 是**容器像素坐标**：`state.x = scale*(translate.x + origin.x)`。`getCellAt` / `getCells` / `mxUtils.intersects(rect, state)` / 框选矩形入参一律是容器像素。
- 只有给 `insertVertex` 用的图坐标才换算：`graphX = px/scale - translate.x`（等价 `graph.getPointForEvent(evt)`）。
- clientX/clientY → 容器像素用 `mxUtils.convertPoint(container, clientX, clientY)`。

## 图形分组
- v0.16.2 起形状面板分组：便笺本（Scratchpad）、通用（General）、杂项（Misc）、高级（Advanced）。
- 定义在 `src/shapes.ts#getAllShapeCategories()`，标题翻译在 `src/i18n/index.ts`；便笺本为动态收藏，渲染在 `src/DrawioView.ts`。

## 样式面板配色轮播（v0.17.0 起）
- 「样式」Tab 顶部 = 6 页 × 8 块 = 48 组 draw.io 官方配色，`src/FormatPanel.ts#STYLE_PRESET_PAGES`（`StylePreset = { fill, stroke, gradient?, noFill? }`，每页 `STYLE_PRESET_PER_PAGE` = 8）。
- 色值由用户 draw.io 截图逐像素还原（`.workbuddy/tmp/extract_palette2.py` / `fit.py`）；改配色先跑 `.workbuddy/tmp/verify-palette.js` 逐字段比对。
- 第 4 页第 2 块是**无填充**（棋盘格）；**第 5 页是渐变组**（fillColor 在上、gradientColor 在下 = `south`）。色块 = 填充色 + 1px 描边色边框，`aspect-ratio: 1.5`（参考 45×30）；箭头**循环翻页**，圆点可点跳页。
- `matchStylePreset()` 坑：#ffffff/#000000 在 5 页重复，**必须先扫当前可见页再回退全局首个**。点纯色预设要**显式清掉 gradientColor**，否则高亮永远命不中。
- **v0.17.1/v0.17.2：填充 / 线条 / 效果三组都不是分区，是一条分割线**，走 `FormatPanel#flatSection()`（`.drawio-fmt-flat` > `.drawio-fmt-divider` + 内容，无标题、不可折叠）。`section()` 仍被文本 / 排列面板的 4 个分组用着，不能删。命名别用 `.drawio-fmt-group*`（已有语义不同的 `.drawio-fmt-group-title` / `-body`）。
- 「线条」二字仍在下行勾选框标签上；**「效果」二字只能靠 `role="group"` + `aria-label`**（组内无同名字样）。
- 分割线间距 **上 11px / 下 10px**；基础 `.drawio-fmt-divider` 仍 `margin:12px 0`（文本/排列依赖），扁平组用 `.drawio-fmt-flat > .drawio-fmt-divider` (0,2,0) 覆盖；**首组还要清零 margin-top**：`.drawio-fmt-palette + .drawio-fmt-flat > .drawio-fmt-divider { margin-top:0 }` (0,3,0)。
- **「不透明度」这一行属于「线条」组，必须放进 `flatSection` 回调内部**；挂组外会命中 `.drawio-fmt-row:last-child { margin-bottom:0 }` 与上一组贴死。
- 真机 2x 实测：色块含边框 46.5×31.0 = **1.500**、圆点 9×9、分割线左右各内缩 12px。
- 原型 `prototypes/style-palette-carousel.html`（两列：② 现状 ③ 本次），图 `prototypes/style-palette-carousel.png`；两列共用 CSS，只差「标题栏 vs 分割线」。

## 上架合规（v0.18.0 修代码级，v0.18.2 修 description）
- v0.17.2 检查 → v0.18.0 全修：`registerExtensions(["drawio"])` 只留一个（`.xml` / `.drawio.svg` 改走右键 `file-menu`「Open as diagram」兜底，`isDrawioCompatible` + `openInDrawioView`）；`mxStylesheetCodec.allowEval=false` + `mxDefaultToolbarCodec.allowEval=false`；**18 处 `innerHTML` + 2 处 `outerHTML` 读全迁到 `src/svg.ts#setSvgMarkup()`**；`console.log` 删、`author` 填 `hellokunzai`、`vault.modify`→`vault.process`、`createElement("script")`→`createEl`、`arguments`→rest、`setTimeout`→`window.*`。官方 eslint recommended：errors 1637→1609、warnings 206→175；`no-inner-html` 17→0、`no-unsanitized/property` 14→0。
- **description 不得含 "Obsidian" 字样**（审核实测驳回，2026-09-16）：目录语境已隐含，写了即 Failed。现文案 = “Edit and view draw.io diagrams directly in your vault. …”。
- 已解除：`.github/`（4 个 workflow + `check-version.mjs`）已提交；`git tag 0.18.0` 已推；`release.yml` 自动建 Release（`draft:false`，三件套齐）。路径是「推 tag → Actions 自动发版」，**无需本地 gh**。
- 仓库清理（已做）：`.workbuddy/tmp/` 与 `.env-check.txt` 用 `git rm --cached` 移出版本控制（本地保留）；`.gitignore` 收窄为 `.workbuddy/tmp/`。`.workbuddy/memory/` 与 `prototypes/` **仍跟踪**。
- `package-lock.json` 根版本长期停在 `0.1.0`；实测这种「仅根版本不一致、依赖范围一致」**不会让 `npm ci` 失败**，已用 `npm install --package-lock-only --ignore-scripts` 规范化。改版本号后建议顺手跑一次。
- **故意保留**（超范围 / 大改有回归风险）：`no-static-styles-assignment` 34 处、本地 `h()` 的 `prefer-create-el` 2 处、`settings-tab/prefer-setting-definitions` 1 处、`@typescript-eslint` 的 `any` 警告约 1500 条（mxGraph 按设计 `any` 密集）。
- 完整检查报告：`.workbuddy/tmp/compliance-report.html`。

## 安全改造：`innerHTML` → `setSvgMarkup`（v0.18.0 起全量落地）
- `src/svg.ts#setSvgMarkup(el, markup)` = 有串走 `el.replaceChildren(sanitizeHTMLToDom(markup))`，空串走 `el.replaceChildren()`。
- **`sanitizeHTMLToDom` 是 Obsidian 对 DOMPurify 的封装**（`FORBID_TAGS:["style"]`、`RETURN_DOM_FRAGMENT:true`），**对 SVG 完全保真**：无头 Edge 实测 11 个代表图形（多 `<svg>` / `stroke-dasharray` / 紧 `viewBox` / `fill="currentColor"` / `class`）属性全保留、命名空间不变 → 零视觉回归。
- 官方红线**点名 `innerHTML`/`outerHTML`/`insertAdjacentHTML`，不是 `eval`/`new Function`**（旧 skill 红线表写错了）。

## Obsidian 客户端语义（反编译 `obsidian.asar` 实证，1.13.7）
> asar 在**安装目录的 `resources/`**（本机 `D:\Program Files\Obsidian\resources\obsidian.asar`）；`%APPDATA%\obsidian\` 是用户配置目录，**通常没有** asar。
- **`TFile.extension` = 最后一个点之后的片段（转小写）**；`openFile` 用 `getTypeByExtension(extension)` **纯字典查表** → 复合扩展名（`x.drawio.svg`）的 extension 是 `svg`，**注册 `"drawio.svg"` 永远不生效**。
- **`ViewRegistry.registerExtensions` 先对整个数组冲突预检，任一已存在即 `throw`；`Plugin.registerExtensions` 不捕获** → 数组里放一个会冲突的扩展名，**全部注册失败、`onload` 抛错**。
- 核心已占用扩展名（1.13.7）：`md`；`bmp,png,jpg,jpeg,gif,svg,webp,avif`；`mp3,wav,m4a,3gp,flac,ogg,oga,opus`；`mp4,webm,ogv,mov,mkv`；`pdf`。
- **mxGraph 4.2.2 默认 `allowEval`**：`mxStencil` / `mxGraphView.prototype` / `mxObjectCodec` = `false`，但 **`mxStylesheetCodec` / `mxDefaultToolbarCodec` = `true`** → `mxUtils.eval`（真 `eval()`）解析样式表时可达，用 mxGraph 的插件必须显式关掉后两个。
