# Drawio Studio

**English** · [简体中文](README.zh.md)

Drawio Studio lets you edit and view [draw.io](https://www.draw.io/) diagrams directly inside Obsidian — fully offline, with no external service and no network requests. It uses the same `.drawio` file format as draw.io, so your diagrams stay portable and open anywhere draw.io does.

## Features

- **Native `.drawio` editing** — open `.drawio` files in an editable canvas. Files with a generic or compound suffix (`.xml`, `x.drawio.svg`) can still be opened via **Open as diagram** in the file-list context menu.
- **Bundled mxGraph engine** — the same open-source engine draw.io is built on, embedded in the plugin. No network, no telemetry.
- **Rich shape palette** — four categories: Scratchpad (your favorites), General, Misc, and Advanced. Search by name; fold / unfold categories. Includes flowchart, UML, network, container, and icon shapes.
- **Drag & drop** — drag shapes from the palette onto the canvas, or double-click empty space to create one.
- **Full toolbar** — undo / redo, zoom in / out, fit to view, reset zoom, delete selection, clear canvas, export SVG, save.
- **Format panel** (shown when a shape is selected): fill color presets (48 built-in palettes across 6 pages), stroke & line style (solid / dashed / dotted), opacity, effects (shadow, rounded, sketch, glass), font / background / border colors, gradients, word wrap, formatted text, spacing, alignment, writing direction, z-order, size & position, rotation, flip, align-to-grid, group / ungroup, lock / unlock, copy style, set as default style.
- **Diagram panel** (shown when nothing is selected): page view, grid size & color, background, shadow, connection arrows / points, alignment guides, page size presets + custom size + orientation, adaptive colors, edit diagram data, clear default style.
- **View menu** — toggle the Shapes palette, Format rail, Ruler, Find / Replace, Layers, Tags, and Outline (minimap).
- **Find / Replace** — search shape text across the diagram, with case matching and replace-all.
- **Layers** — organize shapes into named, show / hide-able, lock / unlock-able layers.
- **Tags** — tag shapes and manage tags across the whole diagram.
- **Outline (minimap)** — navigate large diagrams at a glance.
- **Multi-page diagrams** — add, insert, duplicate, rename, delete, and reorder pages (draw.io multi-page support).
- **Scratchpad** — collect frequently used shapes from the context menu and drag them back onto the canvas anytime.
- **Adaptive colors** — let shape colors follow the active theme automatically.
- **Auto save** — changes are written back to the file after you stop editing (configurable debounce delay).
- **Theme aware** — follows the Obsidian light / dark theme.
- **SVG export** — export the current diagram as an SVG file.

## Installation

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [Release](https://github.com/hellokunzai/obsidian-drawio-studio/releases).
2. Copy them into `<vault>/.obsidian/plugins/drawio-studio/`.
3. Enable **Drawio Studio** under **Settings → Community plugins**.

## Usage

- Run the command **Create new diagram**, or right-click a file / folder in the file list and choose **New flowchart** to create a diagram.
- Double-click a `.drawio` file (or choose **Open as diagram** for `.xml` / `x.drawio.svg`) to open it in the canvas.
- Drag a shape from the right-hand palette onto the canvas.
- Use the toolbar to zoom, export SVG, or save.

## Interface overview

### Toolbar

Located at the top of the diagram view. Buttons: Undo, Redo, Zoom In, Zoom Out, Fit to View, Reset Zoom, Delete Selected, Clear Canvas, Export SVG, Save.

### Shape palette

On the left. Categories (Scratchpad, General, Misc, Advanced) can be folded / unfolded by clicking their headers. A search box filters shapes by name. Drag a shape onto the canvas, or double-click empty canvas to create.

### Format panel (a shape selected)

On the right. Tabs: **Style**, **Text**, **Arrange**.

- **Style** — fill presets, stroke, line style, opacity, effects, colors, gradients.
- **Text** — font color, word wrap, formatted text, spacing, writing direction.
- **Arrange** — alignment, z-order, size / position, rotation, flip, align to grid, group / ungroup, lock / unlock, delete.

### Diagram panel (nothing selected)

On the right. Tabs: **Diagram**, **Style**.

- **Diagram** — page view, grid, background, shadow, options (connection arrows / points, guides), page size.
- **Style** — adaptive colors, default style, edit diagram data.

### View menu

The leftmost toolbar button opens a menu to toggle: Shapes palette, Format rail, Ruler, Find / Replace, Layers, Tags, Outline.

### Floating tool windows

- **Find / Replace** — find shape text, match case, replace / replace all.
- **Layers** — add / reorder / delete layers, show / hide, lock / unlock.
- **Tags** — add / remove tags on the selection and across the whole diagram.
- **Outline** — a minimap of the whole diagram.

### Multi-page

The page bar at the bottom of the canvas supports new / insert / duplicate / rename / delete / reorder pages, matching draw.io's multi-page model.

### Context menu

Right-click a shape to cut, copy, duplicate, paste, lock / unlock, set as default style, change z-order, edit style / data / link / connection points, or add it to the scratchpad.

## Settings

Open **Settings → Community plugins → Drawio Studio**:

| Setting | Description |
| --- | --- |
| Auto save | Write changes back to the file automatically after you stop editing. When off, only the toolbar Save button writes to disk; switching or closing the tab will not write anything. |
| Auto save delay (ms) | How long to wait after the last change before saving (between 200 and 60000 ms). |
| Show grid | Draw the background grid and snap to it while dragging. |
| Default edge style | Routing used for newly drawn connections: **Orthogonal** (right-angle) or **Straight**. Existing edges keep their own style. |

## Technical notes

- Renders with the bundled mxGraph engine (the open-source library draw.io is built on), which is why the plugin needs no network access.
- mxGraph ships with `allowEval` enabled on `mxStylesheetCodec` and `mxDefaultToolbarCodec`, which would let a hand-crafted `.drawio` file run JavaScript from inside its stylesheet. The plugin switches both off immediately after the engine loads, so opening an untrusted file cannot execute script through the stylesheet.
- `isDesktopOnly: true` — desktop only.
- No network requests, no telemetry, no ads.

## Compatibility with other draw.io plugins

`.drawio` can only be claimed by one plugin at a time: Obsidian's view registry rejects a second registration of the same extension, and the plugin that loses the race ends up with a load error. So this plugin **cannot be enabled together with Drawio (`drawio-editor`, by doge-liang) or the older Diagrams (`drawio-obsidian`)** — keep only one of them enabled.

## Development & release

### Local build

```bash
npm install
node node_modules/typescript/bin/tsc -noEmit -skipLibCheck   # type check
npm run build                                                # production build → main.js
```

`main.js` is not tracked by git; the build artifact is produced on the fly by GitHub Actions, so there is no need to commit it manually.

### Release a stable version

1. Bump the version in `manifest.json` and `package.json` to the same value, and append `<version>: <minAppVersion>` to `versions.json`.
2. Commit and push the version bump.
3. Create and push a tag named exactly after the version (no `v` prefix):

   ```bash
   git tag 0.18.3
   git push origin 0.18.3
   ```

GitHub Actions will build and create a GitHub Release with `main.js`, `manifest.json` and `styles.css`. You can also run **Actions → Release → Run workflow** and enter the version to release manually; the workflow creates the tag itself.

### Pre-release (BRAT)

Add a keyword to the commit message:

- `[beta]` → publishes `<version>-beta.<n>`
- `[rc]` → publishes `<version>-rc.<n>` and cleans up leftover beta pre-releases

Ordinary commits do not trigger a release.

### Automated checks

- **CI**: on push to `main` or a PR, runs type checking + build to ensure changes compile.
- **Version Check**: validates that `manifest.json` / `package.json` / `versions.json` agree on the version, and checks manifest metadata compliance (`id` / `name` / `description` / `author`).

Both can be reproduced locally: `node .github/scripts/check-version.mjs`.

## License

[MIT](./LICENSE) © hellokunzai
