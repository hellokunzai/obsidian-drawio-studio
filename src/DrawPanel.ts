import { t } from "./i18n";
import { setSvgMarkup } from "./svg";
import {
  DrawioSettings,
  MAX_GRID_SIZE,
  MAX_PAGE_MM,
  MIN_GRID_SIZE,
  MIN_PAGE_MM,
  PageOrientation,
} from "./settings";

/** 与 FormatPanel 一致的建元素helper：不依赖 Obsidian 的 HTMLElement 扩展 */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 页面尺寸预设（毫米），与 draw.io 常见纸型一致 */
const PAGE_PRESETS: Array<{ v: string; label: string }> = [
  { v: "210x297", label: "A4 (210 mm x 297 mm)" },
  { v: "148x210", label: "A5 (148 mm x 210 mm)" },
  { v: "297x420", label: "A3 (297 mm x 420 mm)" },
  { v: "216x279", label: "Letter (216 mm x 279 mm)" },
];

/** 自定义尺寸的哨兵值，存进 settings.pageSizePreset */
const CUSTOM_PRESET = "custom";

/** 自适应颜色的四种模式，值直接写进 mxGraph 样式 */
const ADAPTIVE_MODES = ["none", "auto", "hue", "lightness"];

/** 整图级样式在 mxGraph 样式串里的键名 */
const STYLE_SKETCH = "sketch";
const STYLE_ROUNDED = "rounded";
const STYLE_SHADOW = "shadow";
const STYLE_ADAPTIVE = "adaptiveColors";

/**
 * 毫米 → mxGraph 页面单位。
 * draw.io 按「1 英寸 = 100 单位」标定纸面尺寸（A4 210×297mm → 827×1169），
 * 与 mxGraph 默认的 pageFormat 完全一致，所以这里沿用同一套换算。
 */
export function mmToPageUnits(mm: number): number {
  return Math.round((mm / 25.4) * 100);
}

/** 面板把改动交回视图执行的宿主接口 */
export interface DrawPanelHost {
  getSettings(): DrawioSettings;
  /** 合并设置补丁：持久化 + 应用到画布 */
  patchSettings(patch: Partial<DrawioSettings>): void;
  /** 打开「编辑数据…」（当前页的 mxGraphModel XML） */
  editPageData(): void;
  /** 清除默认风格 */
  clearDefaultStyle(): void;
  /** 对当前页所有图形写入 / 清除某个样式（value 为 null 表示清除） */
  applyStyleToPage(key: string, value: string | null): void;
  /** 读取当前页所有图形共有的某样式值；不一致或页内无图形时返回 null */
  getPageStyle(key: string): string | null;
}

export class DrawPanel {
  private root: HTMLElement;
  private host: DrawPanelHost;

  // 绘图 Tab
  private gridCheck!: HTMLInputElement;
  private gridSizeInput!: HTMLInputElement;
  private gridColorInput!: HTMLInputElement;
  private gridColorSwatch!: HTMLElement;
  private pageViewCheck!: HTMLInputElement;
  private bgColorInput!: HTMLInputElement;
  private bgColorCheck!: HTMLInputElement;
  private shadowCheck!: HTMLInputElement;
  private arrowsCheck!: HTMLInputElement;
  private connPointsCheck!: HTMLInputElement;
  private guidesCheck!: HTMLInputElement;
  private pageSizeSelect!: HTMLSelectElement;
  private customSizeRow!: HTMLElement;
  private pageWidthInput!: HTMLInputElement;
  private pageHeightInput!: HTMLInputElement;
  private orientRadios: HTMLInputElement[] = [];

  // 样式 Tab
  private adaptiveSelect!: HTMLSelectElement;
  private sketchCheck!: HTMLInputElement;
  private roundedBtn!: HTMLButtonElement;

  constructor(root: HTMLElement, host: DrawPanelHost) {
    this.root = root;
    this.host = host;
    this.build();
    this.refresh();
  }

  // ---------- 构建 DOM ----------

  private build(): void {
    this.root.empty();

    // Tab 行：绘图 | 样式
    const tabs = h("div", "drawio-fmt-tabs");
    const tabDefs = [
      { id: "diagram", label: t("diagram.tab.diagram") },
      { id: "style", label: t("diagram.tab.style") },
    ];
    for (const def of tabDefs) {
      const tab = h("button", "drawio-fmt-tab", def.label);
      tab.dataset.tab = def.id;
      if (def.id === "diagram") tab.classList.add("active");
      tab.addEventListener("click", () => {
        tabs
          .querySelectorAll(".drawio-fmt-tab")
          .forEach((e) => e.classList.remove("active"));
        tab.classList.add("active");
        this.root
          .querySelectorAll(".drawio-fmt-tabpane")
          .forEach((e) => e.classList.remove("active"));
        this.root
          .querySelector(`.drawio-fmt-tabpane[data-pane="${def.id}"]`)
          ?.classList.add("active");
      });
      tabs.appendChild(tab);
    }
    this.root.appendChild(tabs);

    const body = h("div", "drawio-fmt-body");
    body.appendChild(this.buildDiagramPane());
    body.appendChild(this.buildStylePane());
    this.root.appendChild(body);
  }

  /** 绘图 Tab（对应 draw.io 的 Diagram → 查看 / 选项 / 页面尺寸） */
  private buildDiagramPane(): HTMLElement {
    const pane = h("div", "drawio-fmt-tabpane active");
    pane.dataset.pane = "diagram";

    // ---------------- 查看 ----------------
    pane.appendChild(h("div", "drawio-fmt-group-title", t("diagram.group.view")));
    const viewBody = h("div", "drawio-fmt-group-body");

    // 网格 [大小 pt] [色块 🖉]
    const gridRow = h("div", "drawio-fmt-row");
    this.gridCheck = this.checkbox(t("diagram.grid"));
    gridRow.appendChild(this.labelFor(this.gridCheck));
    gridRow.appendChild(h("div", "drawio-fmt-spacer"));

    const gridNum = this.numberField("pt", MIN_GRID_SIZE, MAX_GRID_SIZE);
    this.gridSizeInput = gridNum.input;
    this.gridSizeInput.addEventListener("change", () => {
      const v = this.clamp(
        parseFloat(this.gridSizeInput.value),
        MIN_GRID_SIZE,
        MAX_GRID_SIZE,
        10
      );
      this.gridSizeInput.value = String(v);
      this.host.patchSettings({ gridSize: v });
    });
    gridRow.appendChild(gridNum.el);

    const gridColor = this.colorSwatch("#d0d0d0");
    this.gridColorSwatch = gridColor.wrap;
    this.gridColorInput = gridColor.input;
    this.gridColorInput.addEventListener("input", () => {
      const hex = this.gridColorInput.value;
      this.gridColorSwatch.style.background = hex;
      this.host.patchSettings({ gridColor: hex });
    });
    const gridColorBox = h("div", "drawio-fmt-colorbox");
    gridColorBox.appendChild(this.gridColorSwatch);
    // clickable-icon 是 Obsidian 自己的图标按钮类：挂上它，app.css 里
    // 那条 `button:not(.clickable-icon)` 默认样式就不会命中，顺带拿到原生的图标色/ hover 观感
    const gridPencil = h(
      "button",
      "clickable-icon drawio-fmt-pencil",
      undefined
    ) as HTMLButtonElement;
    gridPencil.type = "button";
    gridPencil.title = t("diagram.gridColorTip");
    setSvgMarkup(
      gridPencil,
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>'
    );
    gridPencil.addEventListener("click", () => this.gridColorInput.click());
    gridColorBox.appendChild(gridPencil);
    gridRow.appendChild(gridColorBox);
    viewBody.appendChild(gridRow);

    this.gridCheck.addEventListener("change", () =>
      this.host.patchSettings({ showGrid: this.gridCheck.checked })
    );

    // 页面视图：勾选后画布按「页面尺寸」1:1 渲染成纸面，所见即所得
    const pvRow = h("div", "drawio-fmt-row");
    this.pageViewCheck = this.checkbox(t("diagram.pageView"));
    this.pageViewCheck.addEventListener("change", () => {
      this.host.patchSettings({ pageView: this.pageViewCheck.checked });
    });
    pvRow.appendChild(this.labelFor(this.pageViewCheck));
    viewBody.appendChild(pvRow);

    // 背景 [更改...]（隐藏的取色 input 挂在按钮后面，点按钮直接唤起系统取色器）
    const bgRow = h("div", "drawio-fmt-row");
    bgRow.appendChild(h("span", "drawio-fmt-label drawio-fmt-label-wide", t("diagram.background")));
    const bgBtn = h(
      "button",
      "drawio-fmt-btn drawio-fmt-grow",
      t("diagram.backgroundChange")
    ) as HTMLButtonElement;
    bgBtn.addEventListener("click", () => this.bgColorInput.click());
    bgRow.appendChild(bgBtn);
    this.bgColorInput = h("input", "drawio-fmt-hidden-color") as HTMLInputElement;
    this.bgColorInput.type = "color";
    this.bgColorInput.addEventListener("input", () =>
      this.host.patchSettings({
        backgroundColor: this.bgColorInput.value,
        backgroundEnabled: true,
      })
    );
    bgRow.appendChild(this.bgColorInput);
    viewBody.appendChild(bgRow);

    // 背景色（启用 / 关闭）
    const bcRow = h("div", "drawio-fmt-row");
    this.bgColorCheck = this.checkbox(t("diagram.backgroundColor"));
    this.bgColorCheck.addEventListener("change", () =>
      this.host.patchSettings({ backgroundEnabled: this.bgColorCheck.checked })
    );
    bcRow.appendChild(this.labelFor(this.bgColorCheck));
    viewBody.appendChild(bcRow);

    // 阴影（作用于当前页所有图形，勾选状态跟随页内图形回填）
    const shRow = h("div", "drawio-fmt-row");
    this.shadowCheck = this.checkbox(t("diagram.shadow"));
    this.shadowCheck.addEventListener("change", () => {
      this.host.applyStyleToPage(
        STYLE_SHADOW,
        this.shadowCheck.checked ? "1" : null
      );
    });
    shRow.appendChild(this.labelFor(this.shadowCheck));
    viewBody.appendChild(shRow);

    pane.appendChild(viewBody);

    // ---------------- 选项 ----------------
    pane.appendChild(
      h("div", "drawio-fmt-group-title", t("diagram.group.options"))
    );
    const optBody = h("div", "drawio-fmt-group-body");

    const mkOption = (
      key: keyof DrawioSettings,
      label: string
    ): HTMLInputElement => {
      const row = h("div", "drawio-fmt-row");
      const check = this.checkbox(label);
      check.addEventListener("change", () => {
        const patch: Partial<DrawioSettings> = {};
        (patch as any)[key] = check.checked;
        this.host.patchSettings(patch);
      });
      row.appendChild(this.labelFor(check));
      optBody.appendChild(row);
      return check;
    };
    this.arrowsCheck = mkOption("connectionArrows", t("diagram.connectionArrows"));
    this.connPointsCheck = mkOption("connectionPoints", t("diagram.connectionPoints"));
    this.guidesCheck = mkOption("guides", t("diagram.guides"));

    pane.appendChild(optBody);

    // ---------------- 页面尺寸 ----------------
    pane.appendChild(
      h("div", "drawio-fmt-group-title", t("diagram.group.pageSize"))
    );
    const sizeBody = h("div", "drawio-fmt-group-body");

    const sizeRow = h("div", "drawio-fmt-row");
    this.pageSizeSelect = h("select", "drawio-fmt-select") as HTMLSelectElement;
    for (const preset of PAGE_PRESETS) {
      const op = h("option", undefined, preset.label) as HTMLOptionElement;
      op.value = preset.v;
      this.pageSizeSelect.appendChild(op);
    }
    const customOp = h(
      "option",
      undefined,
      t("diagram.pageSizeCustom")
    ) as HTMLOptionElement;
    customOp.value = CUSTOM_PRESET;
    this.pageSizeSelect.appendChild(customOp);
    this.pageSizeSelect.addEventListener("change", () => {
      const v = this.pageSizeSelect.value;
      if (v === CUSTOM_PRESET) {
        this.customSizeRow.classList.remove("drawio-hidden");
        this.host.patchSettings({ pageSizePreset: CUSTOM_PRESET });
        return;
      }
      const [w, hh] = v.split("x").map(Number);
      this.customSizeRow.classList.add("drawio-hidden");
      this.host.patchSettings({ pageSizePreset: v, pageWidth: w, pageHeight: hh });
    });
    sizeRow.appendChild(this.pageSizeSelect);
    sizeBody.appendChild(sizeRow);

    // 自定义宽 × 高（仅在选了「自定义…」时出现）：显隐走 .drawio-hidden 工具类
    this.customSizeRow = h("div", "drawio-fmt-row drawio-hidden");
    const wNum = this.numberField("mm", MIN_PAGE_MM, MAX_PAGE_MM);
    this.pageWidthInput = wNum.input;
    this.pageWidthInput.addEventListener("change", () => {
      const v = this.clamp(
        parseFloat(this.pageWidthInput.value),
        MIN_PAGE_MM,
        MAX_PAGE_MM,
        210
      );
      this.pageWidthInput.value = String(v);
      this.host.patchSettings({ pageWidth: v });
    });
    const hNum = this.numberField("mm", MIN_PAGE_MM, MAX_PAGE_MM);
    this.pageHeightInput = hNum.input;
    this.pageHeightInput.addEventListener("change", () => {
      const v = this.clamp(
        parseFloat(this.pageHeightInput.value),
        MIN_PAGE_MM,
        MAX_PAGE_MM,
        297
      );
      this.pageHeightInput.value = String(v);
      this.host.patchSettings({ pageHeight: v });
    });
    this.customSizeRow.appendChild(wNum.el);
    this.customSizeRow.appendChild(hNum.el);
    sizeBody.appendChild(this.customSizeRow);

    // 竖向 / 横向
    const orientRow = h("div", "drawio-fmt-row");
    const radios = h("div", "drawio-fmt-radios");
    // 同名的 radio 在整个 document 内互斥，多个图表视图同时打开要各用各的名字
    const radioGroup = "drawio-page-orient-" + Math.random().toString(36).slice(2, 8);
    const orientDefs: Array<{ v: PageOrientation; label: string }> = [
      { v: "portrait", label: t("diagram.orientationPortrait") },
      { v: "landscape", label: t("diagram.orientationLandscape") },
    ];
    for (const def of orientDefs) {
      const label = h("label", "drawio-fmt-radio");
      const radio = h("input") as HTMLInputElement;
      radio.type = "radio";
      radio.name = radioGroup;
      radio.value = def.v;
      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.host.patchSettings({ pageOrientation: def.v });
        }
      });
      label.appendChild(radio);
      label.appendChild(h("span", undefined, def.label));
      radios.appendChild(label);
      this.orientRadios.push(radio);
    }
    orientRow.appendChild(radios);
    sizeBody.appendChild(orientRow);

    pane.appendChild(sizeBody);

    // ---------------- 底部动作 ----------------
    pane.appendChild(h("div", "drawio-fmt-divider"));

    const editRow = h("div", "drawio-fmt-row");
    const editBtn = h(
      "button",
      "drawio-fmt-btn drawio-fmt-block",
      t("diagram.editData")
    ) as HTMLButtonElement;
    editBtn.addEventListener("click", () => this.host.editPageData());
    editRow.appendChild(editBtn);
    pane.appendChild(editRow);

    const clearRow = h("div", "drawio-fmt-row");
    const clearBtn = h(
      "button",
      "drawio-fmt-btn drawio-fmt-block",
      t("diagram.clearDefaultStyle")
    ) as HTMLButtonElement;
    clearBtn.addEventListener("click", () => this.host.clearDefaultStyle());
    clearRow.appendChild(clearBtn);
    pane.appendChild(clearRow);

    return pane;
  }

  /** 样式 Tab：整图级样式，作用于当前页所有图形 */
  private buildStylePane(): HTMLElement {
    const pane = h("div", "drawio-fmt-tabpane");
    pane.dataset.pane = "style";

    // 自适应颜色
    const adRow = h("div", "drawio-fmt-row");
    adRow.appendChild(
      h("span", "drawio-fmt-label drawio-fmt-label-wide", t("diagram.adaptiveColors"))
    );
    this.adaptiveSelect = h("select", "drawio-fmt-select") as HTMLSelectElement;
    const adaptiveLabels: Record<string, string> = {
      none: t("diagram.adaptiveNone"),
      auto: t("diagram.adaptiveAuto"),
      hue: t("diagram.adaptiveHue"),
      lightness: t("diagram.adaptiveLightness"),
    };
    for (const mode of ADAPTIVE_MODES) {
      const op = h("option", undefined, adaptiveLabels[mode]) as HTMLOptionElement;
      op.value = mode;
      this.adaptiveSelect.appendChild(op);
    }
    this.adaptiveSelect.addEventListener("change", () => {
      const v = this.adaptiveSelect.value;
      this.host.applyStyleToPage(STYLE_ADAPTIVE, v === "none" ? null : v);
    });
    adRow.appendChild(this.adaptiveSelect);
    const help = h("span", "drawio-fmt-help", "?");
    help.title = t("diagram.adaptiveTip");
    adRow.appendChild(help);
    pane.appendChild(adRow);

    // 草图 + 圆角
    const fxRow = h("div", "drawio-fmt-row");
    this.sketchCheck = this.checkbox(t("format.sketch"));
    this.sketchCheck.addEventListener("change", () =>
      this.host.applyStyleToPage(
        STYLE_SKETCH,
        this.sketchCheck.checked ? "1" : null
      )
    );
    fxRow.appendChild(this.labelFor(this.sketchCheck));
    fxRow.appendChild(h("div", "drawio-fmt-spacer"));
    this.roundedBtn = h(
      "button",
      "drawio-fmt-btn",
      t("format.rounded")
    ) as HTMLButtonElement;
    this.roundedBtn.addEventListener("click", () => {
      const next = !this.roundedBtn.classList.contains("active");
      this.host.applyStyleToPage(STYLE_ROUNDED, next ? "1" : null);
      this.roundedBtn.classList.toggle("active", next);
    });
    fxRow.appendChild(this.roundedBtn);
    pane.appendChild(fxRow);

    return pane;
  }

  // ---------- 通用控件 ----------

  private checkbox(label: string): HTMLInputElement {
    const input = h("input") as HTMLInputElement;
    input.type = "checkbox";
    (input as any)._label = label;
    return input;
  }

  /** 把 checkbox 包成「☑ 文案」的可点击 label */
  private labelFor(input: HTMLInputElement): HTMLElement {
    const label = h("label", "drawio-fmt-check");
    label.appendChild(input);
    label.appendChild(h("span", undefined, String((input as any)._label ?? "")));
    return label;
  }

  /** 带上下步进按钮的数字输入框 */
  private numberField(
    unit: string,
    min: number,
    max: number
  ): { el: HTMLElement; input: HTMLInputElement } {
    const wrap = h("div", "drawio-fmt-number");
    const input = h("input", "drawio-fmt-number-input") as HTMLInputElement;
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    wrap.appendChild(input);
    wrap.appendChild(h("span", "drawio-fmt-unit", unit));

    const spin = h("div", "drawio-fmt-spin");
    const step = (delta: number) => {
      const cur = parseFloat(input.value);
      const next = Math.min(
        max,
        Math.max(min, (Number.isFinite(cur) ? cur : 0) + delta)
      );
      input.value = String(next);
      input.dispatchEvent(new Event("change"));
    };
    const up = h("button", "drawio-fmt-spin-btn", "▲") as HTMLButtonElement;
    up.type = "button";
    up.addEventListener("click", () => step(1));
    const down = h("button", "drawio-fmt-spin-btn", "▼") as HTMLButtonElement;
    down.type = "button";
    down.addEventListener("click", () => step(-1));
    spin.appendChild(up);
    spin.appendChild(down);
    wrap.appendChild(spin);

    return { el: wrap, input };
  }

  /** 色块 + 覆盖其上的取色 input */
  private colorSwatch(initial: string): {
    wrap: HTMLElement;
    input: HTMLInputElement;
  } {
    const wrap = h("div", "drawio-fmt-colorswatch");
    wrap.style.background = initial;
    const input = h("input") as HTMLInputElement;
    input.type = "color";
    input.value = initial;
    wrap.appendChild(input);
    return { wrap, input };
  }

  private clamp(
    value: number,
    min: number,
    max: number,
    fallback: number
  ): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  private setNumber(input: HTMLInputElement, value: number): void {
    input.value = String(value);
  }

  // ---------- 刷新 ----------

  /** 把 settings / 当前页内容回填到控件（切换文件或页面后调用） */
  refresh(): void {
    const s = this.host.getSettings();

    this.gridCheck.checked = s.showGrid;
    this.setNumber(this.gridSizeInput, s.gridSize);
    const gridHex = s.gridColor || this.defaultGridColor();
    this.gridColorInput.value = gridHex;
    this.gridColorSwatch.style.background = gridHex;

    this.pageViewCheck.checked = s.pageView;

    this.bgColorCheck.checked = s.backgroundEnabled;
    this.bgColorInput.value = s.backgroundColor || "#ffffff";

    this.arrowsCheck.checked = s.connectionArrows;
    this.connPointsCheck.checked = s.connectionPoints;
    this.guidesCheck.checked = s.guides;

    const isPreset = PAGE_PRESETS.some((p) => p.v === s.pageSizePreset);
    this.pageSizeSelect.value = isPreset ? s.pageSizePreset : CUSTOM_PRESET;
    this.customSizeRow.classList.toggle("drawio-hidden", isPreset);
    this.setNumber(this.pageWidthInput, s.pageWidth);
    this.setNumber(this.pageHeightInput, s.pageHeight);
    this.orientRadios.forEach((r) => {
      r.checked = r.value === s.pageOrientation;
    });

    // 样式 Tab（含「阴影」）反映当前页图形的真实状态
    this.sketchCheck.checked = this.host.getPageStyle(STYLE_SKETCH) === "1";
    this.roundedBtn.classList.toggle(
      "active",
      this.host.getPageStyle(STYLE_ROUNDED) === "1"
    );
    const adaptive = this.host.getPageStyle(STYLE_ADAPTIVE);
    this.adaptiveSelect.value =
      adaptive && ADAPTIVE_MODES.includes(adaptive) ? adaptive : "none";
    this.shadowCheck.checked = this.host.getPageStyle(STYLE_SHADOW) === "1";
  }

  private defaultGridColor(): string {
    return document.body.hasClass("theme-dark") ? "#3a3d42" : "#d0d0d0";
  }

}
