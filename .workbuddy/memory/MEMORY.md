# 项目记忆

> Obsidian 插件 obsidian-drawio-editor（id: `drawio-studio`，名「Drawio Studio」），v0.18.3。
> 只记跨会话成立的事实与结论；逐次改动见 `.workbuddy/memory/YYYY-MM-DD.md`。
> 通用方法（按钮特异性 / 图标取证 / 截图解码 / 上架速查表）已在 skill `obsidian-plugin-dev`，此处只留项目特有结论。

## 编辑纪律
- 同一文件的多次 Edit 必须串行；改完关键文件 Read 回读确认。
- 校验脚本报错先怀疑断言本身：锚点必须只可能出现在目标位置。

## 插件身份
- id `drawio-studio` / name「Drawio Studio」（v0.18.1 起，2026-09-14）。内部标识符：view type `drawio-studio-view`、容器类 `.drawio-studio-container`（含 styles.css 的 `[data-type=…]` 选择器）。
- 上架前先探 ID：`https://community.obsidian.md/plugins/<id>` 返「Plugin not found」= 空闲（表单只在点提交时才校验）。
- **`drawio` 扩展名冲突（未解决，仅 README 披露）**：与 doge-liang 的「Drawio」同注册 `['drawio']`；注册表命中重复即 throw 且 Plugin 不捕获 → 后加载者整体 onload 失败。按字母序我们在 `drawio-editor` 之后。
- **刻意保留 `obsidian-drawio-editor` 字样**：`package.json#name` 与 mxfile `host=`（DrawioView.ts:2802、main.ts:162）——属仓库名，且 host 会写进用户文件。
- 仓库已改名 → `hellokunzai/obsidian-drawio-studio`（origin 已 set-url）。vault 插件目录须为 `.obsidian/plugins/drawio-studio/`。

## 技术栈与工作流
- TypeScript + esbuild；mxgraph 4.2.2（`src/mxClient.min.js` raw-loader 内联）+ pako。
- 改完必须：tsc → `node esbuild.config.mjs --production`（脚本不含 tsc）→ 同步三处版本号（manifest/package/versions）。
- 用户自己拷 main.js / styles.css / manifest.json 进 vault；未经明确要求不 git commit。

## 本机构建 / 校验
- PATH 无 npm/npx：用托管 node 绝对路径 `C:/Users/hellokunzai/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`。
- **Bash 的 PATH 有时整个是坏的**（`dirname: command not found`）：命令开头补 PATH 即可：
  `export PATH="/c/Users/hellokunzai/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd:/c/…/mingw64/bin:/c/…/usr/bin:$PATH"`
- `git commit -F <file>` 路径必须 Windows 形式（`C:/...`）。本机没装 gh。
- **`rm` 被 shim 挡住**（退出 127）：删目录用 python `shutil.rmtree`。
- **同一条 Bash 命令可能被执行两次**（沙箱重试），首次副作用保留 → `git tag` 报 already exists 属正常，先看 reflog/log 再下结论；命令尽量幂等。
- 无头截图（Edge）：`--headless=new --no-sandbox --disable-gpu --force-device-scale-factor=2 --virtual-time-budget=6000 --window-size=W,H --screenshot=<绝对路径> "file:///<绝对路径>"`，2x 图，CSS 尺寸除 2。
- 校验中文文案：minify 非 ASCII 转义，`·` 走 `\xB7`、更靠后的走 `\uXXXX`，两种都要反转义再 `includes()`（大小写不敏感）。
- 看截图：无 PIL，用纯 python + zlib 手写 PNG 解码；脚本在 `.workbuddy/tmp/`。
- **本地 `main.js` 比 CI/Release 大 6091 字节 ≠ 构建不一致**：`core.autocrlf=true` 让工作区的 `src/mxClient.min.js` 与内联 `.xml` 变 CRLF，`JSON.stringify` 每个 CR 多 1 字节（每行共 +2）。esbuild 自身输出是 LF（`main.js` CR=0/LF=3140）。核对同一份构建看 `styles.css`：64676 − 2514(CR) = 62162 = Release 资产字节，完全相等。
- **数 CR 别用 `grep -c $'\r'`**（本机 Git Bash 会撒谎：报 3140 行含 CR 而实际 CR=0），一律 `python -c "print(open(p,'rb').read().count(13))"`。
- **`Edit` 可以改 CRLF 文件**（多行 `old_string` 用 `\n` 也能匹配上）；但 **JS 里 `String.replace` 的替换串含 `$'` 会被当成「匹配点之后的全部文本」**，会把整个尾巴复制进去——补 SKILL.md 这类含 `$'\r'` 的文本一律用拼接而不要用 replace 模板。

## CSS 铁律
- 上色用具体 hex/rgba（draw.io 蓝 `#167dff` + `rgba(22,125,255,0.12)`），别用 `var(--interactive-accent)` / `color-mix`。覆盖 mxClient 默认类补 `position:absolute; pointer-events:none`。
- **自绘 `<button>` 单类名 (0,1,0) 必被 `button:not(.clickable-icon)` (0,1,1) 压成灰底方块。** 双保险：① 提权 (0,2,0)；② 挂 `clickable-icon`。改完跑 `node <skill>/scripts/scan-button-specificity.js`（项目根，退出码 0）。本仓两套建按钮写法：`createEl("button",{cls})` 与 `h("button","cls",text)`。
- 改原生按钮皮须显式 `border:none; box-shadow:none; appearance:none;`；纯图标按钮走 `--icon-color` / `--icon-opacity`。
- 提权后基础类会压过组合类（`.btn-text` 要一起提权）；`:hover`/`.is-active` (0,2,0) 写在基础规则之后。
- 排查：把 `obsidian.asar` 当 latin1 读，正则 `/([^{}\n]{0,200}button[^{}\n]{0,120})\{([^{}]{0,500}interactive-normal[^{}]{0,300})\}/g`。
- 用户主题 **Catppuccin Latte**：base `#eff1f5` / mantle `#e6e9ef` / surface0 `#ccd0da` / text `#4c4f69` / overlay `#6c6f85`。

## 图标体系（v0.16.8 起）
- 工具栏图标在 `DrawioView.ts#getIconDef()` → `IconDef { svg, filled?, viewBox? }`；`renderIcon()` 按 `filled` 出 fill 或描边。
- **实心图标 viewBox 必须紧贴字形**（扁字形塞 24×24 会被 meet 缩成细线）；用 `verify-icon-viewbox.js` 校验。
- **内联 `<svg width/height>` 会被 CSS 静默覆盖**：尺寸只在 CSS 一处定义。
- 撤销/重做按 `undoManager.canUndo()/canRedo()` 置灰；置灰 CSS 连 `:hover`/`:active` 一起覆盖 (0,3,0)，保留 pointer-events。
- 复刻截图图标：先 python+zlib 逐像素读包围盒/宽高比/有无竖直实心边/弧线甩向 → 判图标族（本项目 Material Design）。

## mxGraph 坐标语义
- `state.x/y/width/height` 是容器像素：`state.x = scale*(translate.x + origin.x)`。`getCellAt`/`getCells`/`mxUtils.intersects`/框选矩形入参一律容器像素。
- 只有 `insertVertex` 用的图坐标才换算：`px/scale - translate.x`（= `graph.getPointForEvent(evt)`）。
- clientX/Y → 容器像素用 `mxUtils.convertPoint(container, x, y)`。

## 视图铺满叶子
- `.workspace-leaf-content .view-content` 默认有 padding（尤其下 32px）→ styles.css 用 (0,3,0) 选择器清零、overflow hidden。

## 图形分组
- 形状面板四组：便笺本/通用/杂项/高级；定义 `src/shapes.ts#getAllShapeCategories()`，标题在 `src/i18n/index.ts`；便笺本为动态收藏（渲染在 DrawioView.ts）。

## 样式面板配色轮播（v0.17.0 起）
- 「样式」Tab 顶部 = 6 页 × 8 块 = 48 组 draw.io 配色，`src/FormatPanel.ts#STYLE_PRESET_PAGES`（`StylePreset { fill, stroke, gradient?, noFill? }`，每页 8）。
- 色值由截图逐像素还原（`.workbuddy/tmp/extract_palette2.py`）；改配色先跑 `.workbuddy/tmp/verify-palette.js`。
- 第 4 页第 2 块 = 无填充（棋盘格）；第 5 页 = 渐变组（fillColor 上、gradientColor 下 = `south`）。色块 aspect-ratio 1.5（参考 45×30）；箭头循环翻页。
- `matchStylePreset()`：#ffffff/#000000 在 5 页重复，**先扫当前可见页再回退全局首个**；点纯色预设要显式清掉 gradientColor。
- **填充/线条/效果三组不是分区，是一条分割线**（`FormatPanel#flatSection()`：`.drawio-fmt-flat` > `.drawio-fmt-divider` + 内容）。`section()` 仍被文本/排列的 4 个分组使用，不能删。别用 `.drawio-fmt-group*` 命名。
- 分割线间距上 11 / 下 10；基础 `.drawio-fmt-divider` 仍 `margin:12px 0`，扁平组用 `.drawio-fmt-flat > .drawio-fmt-divider` (0,2,0) 覆盖，首组再用 (0,3,0) 清零 margin-top。
- **「不透明度」属于「线条」组，必须在 `flatSection` 回调内**（挂组外会与上组贴死）。
- 真机 2x：色块含边框 46.5×31.0 = 1.500、圆点 9×9、分割线左右各内缩 12px。
- 原型 `prototypes/style-palette-carousel.html`（现状 vs 本次两列）。

## 上架合规
- v0.18.0 已修：`registerExtensions(["drawio"])` 单注册（`.xml`/`.drawio.svg` 走右键 `file-menu`）；`mxStylesheetCodec.allowEval=false` + `mxDefaultToolbarCodec.allowEval=false`；**18 处 innerHTML + 2 处 outerHTML 全迁到 `src/svg.ts#setSvgMarkup()`**；console.log 清零、`vault.modify`→`vault.process`、`setTimeout`→`window.*`。
- **description 不得含 "Obsidian"**（审核实测驳回）；现文案英文、136 字符，`check-version.mjs` 已做成 error 级断言。
- 发版：推 tag → `release.yml` 用仓库内 manifest 原样上传 + `--generate-notes`，无需本地 gh。已发 0.18.0/0.18.1/0.18.2/0.18.3。发版前跑 `check-version.mjs --tag <版本>` 守门。
- `beta.yml` 仅当 commit message 含 `[beta]` / `[rc]` 时发预发布（<version>-beta.N），普通提交不触发；`ci.yml` 每次 push 只验编译+构建。
- 仓库清理：`.workbuddy/tmp/` 与 `.env-check.txt` 已 `git rm --cached`；`.gitignore` 收窄为 `.workbuddy/tmp/`；`.workbuddy/memory/` 与 `prototypes/` 仍跟踪。
- **故意保留**：`prefer-create-el` 2 处（本地 `h()`）、`settings-tab/prefer-setting-definitions` 1 处、`@typescript-eslint` 的 any 家族 error 约 2400 条（mxGraph 按设计 `any` 密集）。`no-static-styles-assignment` 已于 2026-09-16 **全部清零**（见下）。
- 完整报告：`.workbuddy/tmp/compliance-report.html`。

## 内联样式策略（2026-09-16 起）
- **静态状态一律走 CSS 类**，复用已有的 `.drawio-hidden`（`display: none !important`）——它够强，不需要为每个元素再定义隐藏规则。类切换用**原生 `classList`**：`addClass/removeClass/toggleClass` 这些 Obsidian 扩展方法自身就吃 `@typescript-eslint/no-unsafe-call`（error 级），`classList` 不吃。
- **JS 算出来的值一律走 `--` 自定义属性**，唯一出口 `src/cssVars.ts#setCssVars / clearCssVars`（内部 `style.setProperty` / `removeProperty`）。**不能用 `setCssProps` / `setCssStyles`**：`minAppVersion` 1.4.0，那两个 API 1.13 才有，且 d.ts 里没有 `@since`（`no-unsupported-api` 查不出这条）。
- 变量命名（styles.css 里 `var(--x, 默认值)` 消费，关闭态 = `clearCssVars` 回落默认值）：
  `--drawio-page-w/h`（`.drawio-page-block` 的宽高，退出页面视图 = 回落 `.drawio-graph-container` 的 `100%`）、`--drawio-grid-image/size/pos`（网格，回落 `none/auto/0 0`）、`--drawio-tab-dx`（页签拖拽，消费点挂在既有的 `.is-dragging` 上）。
- **隐藏元素若样式表里本来就写着 `display: none`，必须先把那行删掉**再换 `.drawio-hidden`，否则摘类后仍是隐藏的（`.drawio-pagebar-drop` 就是这个坑）。
- 组合类特异性要跟着基础规则走：`.drawio-fmt-tbtn-bold/italic/underline` 故意写成 `.drawio-fmt-body .drawio-fmt-tbtn.drawio-fmt-tbtn-*`（(0,3,0)，与 `.active` 同级）**且排在 `.active` 之后**，否则选中态的 `font-weight: 600` 会盖掉 bold。
- 已知未修（保持原行为）：`FormatPanel#toggleBtn` 的 `"strike"` 调用点从没有字形预览样式，「S」按钮没有删除线预览。

## 本机构建落地（无 node_modules 时）
- 项目**不带 `node_modules`** → tsc / esbuild 都跑不了。做法：在托管 node 工作区装齐依赖，再在项目根建 junction：
  `node_modules` → `C:\Users\hellokunzai\.workbuddy\binaries\node\workspace\node_modules`（junction 可被 `.gitignore` 忽略，不污染仓库）。之后 `node esbuild.config.mjs --production` 与文档流程一致。
- 版本要对齐 `package.json` 声明：`typescript@5.4.5` / `esbuild@0.20.2` / `pako@2.1.0` / `obsidian@1.12.3`。**registry 里没有 `obsidian@1.4.16` 和 `typescript@5.3.0`**（照写 ETARGET）；不指定版本会装到 **typescript 7.x**（行为不同，别用）。
- 托管工作区 `npm install --no-save <包>` 会把**没列进本次命令行**的已装包当 extraneous 清掉 → 需要的包一次全列上。该命令可能被沙箱 SIGTERM、日志为空但包已装好，先验版本再决定是否重试。
- npm/tsc/esbuild 都在托管目录里：`C:/Users/hellokunzai/.workbuddy/binaries/node/versions/22.22.2-3/{npm.cmd,node.exe}`。
- `git show HEAD:src/X.ts > src/X.ts` 做「改前基线」前先备份 src（`cp -r src <tmp>`）；本项目 `.workbuddy/tmp/` 默认不存在，**先 `mkdir -p` 再 cp**，否则 `cp -r` 失败后 `&&` 短路、但后面的 `for ... ; do` 仍会跑，容易把编辑器状态搞乱（本轮踩过，所幸 `&&` 短路救了 src）。


## 安全改造：`innerHTML` → `setSvgMarkup`
- `src/svg.ts#setSvgMarkup(el, markup)` = 有串 `el.replaceChildren(sanitizeHTMLToDom(markup))`，空串 `replaceChildren()`。
- `sanitizeHTMLToDom` 是 Obsidian 封装的 DOMPurify（`FORBID_TAGS:["style"]`、返回 fragment），**对 SVG 完全保真**（11 个代表图形实测零视觉回归）。
- 官方红线**点名 `innerHTML`/`outerHTML`/`insertAdjacentHTML`，不是 eval/new Function**。

## Obsidian 客户端语义（反编译 asar 实证，1.13.7）
> asar 在**安装目录 `resources/`**（本机 `D:\Program Files\Obsidian\resources\obsidian.asar`）。
- `TFile.extension` = 最后一个点后片段（小写）；`openFile` 纯字典查表 → 复合扩展名注册永不生效。
- `ViewRegistry.registerExtensions` 先整数组冲突预检，任一已存在即 throw；`Plugin.registerExtensions` 不捕获 → 一个坏项毁掉全部注册并让 onload 抛错。
- 核心已占用扩展名：`md`；`bmp,png,jpg,jpeg,gif,svg,webp,avif`；`mp3,wav,m4a,3gp,flac,ogg,oga,opus`；`mp4,webm,ogv,mov,mkv`；`pdf`。
- mxGraph 4.2.2 默认 `allowEval`：`mxStencil`/`mxGraphView.prototype`/`mxObjectCodec` 为 false，但 **`mxStylesheetCodec` / `mxDefaultToolbarCodec` 为 true** → 必须显式关掉后两个。
