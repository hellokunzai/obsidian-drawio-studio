# Drawio Studio

Edit and view [draw.io](https://www.drawio.com/) diagrams directly inside Obsidian — works fully offline, with no external service and no network requests.

## Features

- Opens `.drawio` files in an editable canvas view. Files that use a generic or compound suffix (`.xml`, `x.drawio.svg`) can still be opened through **Open as diagram** in the file list context menu
- Built-in shape palette: basic shapes, connectors, containers, flowchart, UML, network, icons
- Collapsible shape categories — click a category header to fold it
- Toolbar: undo / redo, zoom, fit, delete, clear canvas, export SVG, save
- Drag shapes onto the canvas, or double-click empty space to create one
- Autosave — changes are written back to the file as you edit
- Follows the Obsidian light / dark theme

## Installation

1. Download `main.js`, `manifest.json` and `styles.css` from the latest Release
2. Copy them into `<vault>/.obsidian/plugins/drawio-studio/`
3. Enable **Drawio Studio** under Settings → Community plugins

## Usage

- Run the command **Create new diagram**, or right-click a file / folder in the file list and choose **New flowchart**
- Drag a shape from the right-hand palette onto the canvas
- Use the toolbar to zoom, export or save

## Technical notes

- Renders with the bundled mxGraph engine (the open-source library draw.io is built on), which is why the plugin needs no network access
- mxGraph ships with `allowEval` enabled on `mxStylesheetCodec` and `mxDefaultToolbarCodec`, which would let a hand-crafted `.drawio` file run JavaScript from inside its stylesheet. The plugin switches both off immediately after the engine loads
- `isDesktopOnly: true` — desktop only
- No network requests, no telemetry, no ads

## Compatibility with other draw.io plugins

`.drawio` can only be claimed by one plugin at a time: Obsidian's view registry rejects a second
registration of the same extension, and the plugin that loses the race ends up with a load error.
So this plugin cannot be enabled together with **Drawio** (`drawio-editor`, by doge-liang) or the
older **Diagrams** (`drawio-obsidian`) — keep only one of them enabled.

## Licence

[MIT](./LICENSE) © hellokunzai

---

# 中文说明

在 Obsidian 中直接编辑和查看 draw.io 图表，无需任何外部依赖或网络请求。

## 功能特性

- 在 Obsidian 内打开 `.drawio` 文件为可编辑的流程图视图；使用通用后缀或复合后缀的文件（`.xml`、`x.drawio.svg`）可在文件列表中右键 **以流程图打开**
- 内置形状面板：基础图形、连线、容器、流程图、UML、网络图、图标等分类
- 形状分类支持折叠 / 展开，点击分类标题即可收起或展开
- 工具栏：撤销 / 重做、缩放、适应视图、删除、清空画布、导出 SVG、保存
- 拖拽形状到画布，或双击画布空白处快速创建
- 自动保存，随文件实时写入
- 适配 Obsidian 亮色 / 暗色主题

## 安装

1. 下载最新 Release 中的 `main.js`、`manifest.json`、`styles.css` 三个文件
2. 放入 `<vault>/.obsidian/plugins/drawio-studio/` 目录
3. 在 Obsidian 设置 → 社区插件中启用 **Drawio Studio**

## 使用

- 运行命令 **Create new diagram**，或在文件列表里右键文件 / 文件夹选 **新建流程图** 新建图表
- 从右侧形状面板拖拽形状到画布
- 点击工具栏图标进行缩放、导出、保存等操作

## 技术说明

- 基于打包进插件的 mxGraph 渲染引擎（draw.io 的底层库），因此 **无需联网**
- mxGraph 出厂时给 `mxStylesheetCodec` / `mxDefaultToolbarCodec` 打开了 `allowEval`，
  插件在引擎加载后立即把两者关掉，因此打开手工构造的 `.drawio` 文件无法借样式表执行 JS
- `isDesktopOnly: true`，仅在桌面端可用
- 无网络请求、无遥测、无广告

## 开发与发版

本地构建：

```bash
npm install
node node_modules/typescript/bin/tsc -noEmit -skipLibCheck   # 类型检查
npm run build                                                # 生产构建，产出 main.js
```

### 发布正式版

`main.js` 未被 git 跟踪，构建产物由 GitHub Actions 现场生成，无需手动提交。

1. 同步升版本号：`manifest.json` 与 `package.json` 改成同一版本，并在 `versions.json` 追加 `<版本>: <minAppVersion>` 条目
2. 提交并推送这次版本号改动
3. 打 tag 并推送（**tag 名就是版本号，不加 `v` 前缀**）：

   ```bash
   git tag 0.18.2
   git push origin 0.18.2
   ```

CI 会构建后创建 GitHub Release，附 `main.js` / `manifest.json` / `styles.css` 三件套。

也可以在 GitHub 仓库的 **Actions → Release → Run workflow** 里填版本号手动发版，由 workflow 自己打 tag。

### 预发布（BRAT）

在 commit message 里带关键字即可：

- `[beta]` → 生成 `<版本>-beta.<序号>` 预发布版
- `[rc]` → 生成 `<版本>-rc.<序号>` 预发布版，并清理本轮遗留的 beta 预发布

普通 commit 不会触发发布。

### 自动化检查

- **CI**：push 到 main 或提 PR 时跑类型检查 + 构建，确保改动可编译
- **Version Check**：校验 `manifest.json` / `package.json` / `versions.json` 三处版本号一致，并顺带检查 manifest 元数据合规（id / name / description / author）
- 两个检查都可在本地复现：`node .github/scripts/check-version.mjs`

## 与其它 draw.io 插件的兼容性

`.drawio` 这个扩展名同一时刻只能被一个插件占用：Obsidian 的视图注册表会拒绝重复注册，
注册失败的那个插件会直接加载失败。所以本插件**无法与已上架的 Drawio（`drawio-editor`，作者
doge-liang）或更早的 Diagrams（`drawio-obsidian`）同时启用**——后加载的那一个会报加载错误，
请只保留其中一个。

## 许可证

[MIT](./LICENSE) © hellokunzai
