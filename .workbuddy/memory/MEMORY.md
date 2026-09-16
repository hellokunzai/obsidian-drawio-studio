# 项目记忆

> Obsidian 插件，id `drawio-studio` / 名「Drawio Studio」(v0.18.1 起，2026-09-14)，当前 v0.18.3。
> 仓库 `hellokunzai/obsidian-drawio-studio`。vault 插件目录 `.obsidian/plugins/drawio-studio/`。
> 只记跨会话成立的事实与结论；逐次改动见 `.workbuddy/memory/YYYY-MM-DD.md`。
> 通用方法（按钮特异性 / 图标取证 / 截图解码 / 上架速查表）已进 skill `obsidian-plugin-dev`，此处只留项目特有结论。

## 编辑纪律
- 同一文件多次 Edit 必须串行；改完关键文件 Read 回读确认。
- 校验脚本报错先怀疑断言本身：锚点必须只可能出现在目标位置。
- JS 里 `String.replace` 替换串含 `$'` 会被当成「匹配点之后的全部文本」→ 补含 `$'\r'` 的文本一律用拼接，不用 replace 模板。

## 插件身份
- 内部标识符：view type `drawio-studio-view`、容器类 `.drawio-studio-container`（`[data-type=…]` 选择器）。
- 上架前探 ID：`https://community.obsidian.md/plugins/<id>` 返「Plugin not found」= 空闲。
- **`drawio` 扩展名冲突（仅 README 披露）**：与 doge-liang「Drawio」(`drawio-editor`) 同注册 `['drawio']`；命中重复即 throw 且 Plugin 不捕获 → 后加载者 onload 失败。按字母序我们在 `drawio-editor` 之后。
- **刻意保留 `obsidian-drawio-editor` 字样**：`package.json#name` 与 mxfile `host=`（DrawioView.ts:2802、main.ts:162）——属仓库名，host 会写进用户文件。

## 技术栈与工作流
- TypeScript + esbuild；mxgraph 4.2.2（`src/mxClient.min.js` raw-loader 内联）+ pako。
- 改完：tsc → `node esbuild.config.mjs --production`（脚本不含 tsc）→ 同步三处版本号（manifest/package/versions）。
- 用户自己拷 main.js / styles.css / manifest.json 进 vault；未经明确要求不 git commit。

## 本机构建 / 校验
- PATH 无 npm/npx：用托管 node 绝对路径 `C:/Users/hellokunzai/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`；该目录也有 `npm.cmd`。
- Bash 的 PATH 有时整个是坏的：命令开头补 `export PATH="/c/Users/hellokunzai/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd:/c/…/mingw64/bin:/c/…/usr/bin:$PATH"`。
- `git commit -F <file>` 路径必须 Windows 形式（`C:/...`）；本机没装 gh。
- `rm` 被 shim 挡住（退出 127）：删目录用 python `shutil.rmtree`。
- 同一条 Bash 命令可能被执行两次（沙箱重试）→ `git tag` 报 already exists 属正常；命令尽量幂等。
- 项目不带 `node_modules`：在托管 node 工作区装齐依赖（`typescript@5.4.5` / `esbuild@0.20.2` / `pako@2.1.0` / `obsidian@1.12.3`；registry 无 `obsidian@1.4.16`、`typescript@5.3.0`，且不指定版本会装到 typescript 7.x），再在项目根建 junction `node_modules → <托管工作区>/node_modules`（可被 `.gitignore` 忽略）。`npm install --no-save <包>` 会把没列进本次命令行的已装包清掉 → 一次全列上；该命令可能被 SIGTERM、日志为空但包已装好，先验版本再决定重试。
- 无头截图（Edge，2x）：`--headless=new --no-sandbox --disable-gpu --force-device-scale-factor=2 --virtual-time-budget=6000 --window-size=W,H --screenshot=<绝对路径> "file:///<绝对路径>"`，CSS 尺寸除 2。**别加 `--user-data-dir`**（本机 Edge 152 会静默 exit=21 出空输出）；复用同一目录也可能再次出空 → 每次测量前 `rm -rf` 该目录。
- 校验中文文案：minify 非 ASCII 转义（`·`→`\xB7`，更靠后→`\uXXXX`），两种都要反转义再 `includes()`（大小写不敏感）。看截图无 PIL：纯 python + zlib 手写 PNG 解码，脚本在 `.workbuddy/tmp/`。
- 本地 main.js 比 Release 大 6091 字节 ≠ 构建不一致：`core.autocrlf=true` 让内联资源变 CRLF，`JSON.stringify` 每个 CR 多 1 字节；esbuild 自身输出是 LF。核对看 styles.css：本地字节 − CR 数 = Release 资产字节。数 CR 一律 `python -c "print(open(p,'rb').read().count(13))"`，别用 `grep -c $'\r'`（Git Bash 撒谎）。

## CSS 铁律
- 上色用具体 hex/rgba（draw.io 蓝 `#167dff` + `rgba(22,125,255,0.12)`），别用 `var(--interactive-accent)` / `color-mix`。覆盖 mxClient 默认类补 `position:absolute; pointer-events:none`。
- **自绘 `<button>` 单类名 (0,1,0) 必被 `button:not(.clickable-icon)` (0,1,1) 压成灰底方块。** 双保险：① 提权 (0,2,0)；② 挂 `clickable-icon`。改完跑 `node <skill>/scripts/scan-button-specificity.js`（退出码 0）。两套建按钮写法：`createEl("button",{cls})` 与 `h("button","cls",text)`。
- 改原生按钮皮须显式 `border:none; box-shadow:none; appearance:none;`；纯图标按钮走 `--icon-color` / `--icon-opacity`。提权后组合类（`.btn-text` 等）要一起提权且写在 `.active` 之后。
- 排查：把 `obsidian.asar` 当 latin1 读，正则 `/([^{}\n]{0,200}button[^{}\n]{0,120})\{([^{}]{0,500}interactive-normal[^{}]{0,300})\}/g`。
- 用户主题 **Catppuccin Latte**：base `#eff1f5` / mantle `#e6e9ef` / surface0 `#ccd0da` / text `#4c4f69` / overlay `#6c6f85`。
- `.workspace-leaf-content .view-content` 默认有 padding（尤其下 32px）→ styles.css 用 (0,3,0) 选择器清零、overflow hidden。

## 图标体系（v0.16.8 起）
- 工具栏图标 `DrawioView.ts#getIconDef()` → `IconDef { svg, filled?, viewBox? }`；`renderIcon()` 按 `filled` 出 fill 或描边。
- 实心图标 viewBox 必须紧贴字形（扁字形塞 24×24 会被 meet 缩成细线）；用 `verify-icon-viewbox.js` 校验。内联 `<svg width/height>` 会被 CSS 静默覆盖 → 尺寸只在 CSS 一处定义。
- 撤销/重做按 `undoManager.canUndo()/canRedo()` 置灰；置灰 CSS 连 `:hover`/`:active` 一起覆盖 (0,3,0)，保留 pointer-events。
- 复刻截图图标：先 python+zlib 逐像素读包围盒/宽高比/有无竖直实心边/弧线甩向 → 判图标族（本项目 Material Design）。

## mxGraph 坐标语义
- `state.x/y/width/height` 是容器像素（`scale*(translate.x+origin.x)`）。`getCellAt`/`getCells`/`mxUtils.intersects`/框选矩形入参一律容器像素。
- 只有 `insertVertex` 的图坐标才换算：`px/scale - translate.x`（= `graph.getPointForEvent(evt)`）。clientX/Y → 容器像素用 `mxUtils.convertPoint(container, x, y)`。

## 图形分组 / 样式面板配色
- 形状面板四组：便笺本/通用/杂项/高级（`src/shapes.ts#getAllShapeCategories()`，标题在 `src/i18n/index.ts`；便笺本为动态收藏，渲染在 DrawioView.ts）。
- 「样式」Tab 顶部 6 页 × 8 块 = 48 组配色（`src/FormatPanel.ts#STYLE_PRESET_PAGES`，`StylePreset { fill, stroke, gradient?, noFill? }`）。色值由截图逐像素还原；第 4 页第 2 块 = 无填充，第 5 页 = 渐变组（south）。`matchStylePreset()` 先扫当前可见页再回退全局首个；点纯色预设要显式清掉 gradientColor。
- 填充/线条/效果三组是一条分割线（`FormatPanel#flatSection()`），不是分区；`.drawio-fmt-divider` 用 (0,2,0) 覆盖、首组 (0,3,0) 清零 margin-top。「不透明度」属线条组，必须在 `flatSection` 回调内。

## 内联样式策略（2026-09-16 起）
- 静态状态一律走 CSS 类，复用已有 `.drawio-hidden`（`display:none !important`）；类切换用原生 `classList`（别用 Obsidian 的 `addClass/removeClass/toggleClass` —— 它们吃 `@typescript-eslint/no-unsafe-call` error 级）。
- JS 算出来的值一律走 `--` 自定义属性，出口 `src/cssVars.ts#setCssVars/clearCssVars`（`style.setProperty`/`removeProperty`）。**不能用 `setCssProps`/`setCssStyles`**：`minAppVersion` 1.4.0，两 API 1.13 才有且 d.ts 无 `@since`（`no-unsupported-api` 查不出）。变量如 `--drawio-page-w/h`、`--drawio-grid-image/size/pos`、`--drawio-tab-dx`。
- 隐藏元素若样式表本来写 `display:none`，须先删那行再换 `.drawio-hidden`，否则摘类仍隐藏。组合类特异性跟着基础规则走且排在 `.active` 之后。

## 上架合规
- v0.18.0 已修：`registerExtensions(["drawio"])` 单注册（`.xml`/`.drawio.svg` 走右键 `file-menu`）；`mxStylesheetCodec.allowEval=false` + `mxDefaultToolbarCodec.allowEval=false`；18 处 innerHTML + 2 处 outerHTML 全迁到 `src/svg.ts#setSvgMarkup()`（= `el.replaceChildren(sanitizeHTMLToDom(markup))`，空串 `replaceChildren()`；sanitizeHTMLToDom 封装 DOMPurify，`FORBID_TAGS:["style"]`，对 SVG 保真）；console.log 清零、`vault.modify`→`vault.process`、`setTimeout`→`window.*`。
- **description 不得含 "Obsidian"**（审核实测驳回）；现英文 136 字符，`check-version.mjs` 已做 error 级断言。
- 发版：推 tag → `release.yml` 用仓库内 manifest 原样上传 + `--generate-notes`，无需本地 gh。已发 0.18.0/1/2/3。发版前跑 `check-version.mjs --tag <版本>` 守门。
- `beta.yml` 仅当 commit message 含 `[beta]`/`[rc]` 发预发布（<version>-beta.N / -rc.N，rc 清理 beta）；`ci.yml` 每次 push 只验编译+构建。
- **故意保留**：`prefer-create-el` 2 处、`settings-tab/prefer-setting-definitions` 1 处、`@typescript-eslint` any 家族 error 约 2400 条（mxGraph 按设计 any 密集）。`no-static-styles-assignment` 已于 2026-09-16 全部清零。

## Obsidian 客户端语义（反编译 asar 实证，1.13.7）
- asar 在安装目录 `resources/`（`D:\Program Files\Obsidian\resources\obsidian.asar`）。
- `TFile.extension` = 最后一个点后片段（小写）；`openFile` 纯字典查表 → 复合扩展名注册永不生效。
- `ViewRegistry.registerExtensions` 先整数组冲突预检，任一已存在即 throw；`Plugin.registerExtensions` 不捕获 → 一个坏项毁掉全部注册并让 onload 抛错。
- 核心已占用扩展名：`md`；图 `bmp,png,jpg,jpeg,gif,svg,webp,avif`；音 `mp3,wav,m4a,3gp,flac,ogg,oga,opus`；视频 `mp4,webm,ogv,mov,mkv`；`pdf`。
- mxGraph 4.2.2 默认 `allowEval`：`mxStencil`/`mxGraphView`/`mxObjectCodec` 为 false，但 **`mxStylesheetCodec` / `mxDefaultToolbarCodec` 为 true** → 必须显式关掉后两个。
