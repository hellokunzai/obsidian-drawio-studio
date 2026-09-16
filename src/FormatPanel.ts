import { mxUtils, mxConstants } from "./mxgraph-setup";
import { t } from "./i18n";
import { setSvgMarkup } from "./svg";

/** 帮助函数：用原生 DOM 创建元素，保持本模块不依赖 Obsidian 的 HTMLElement 扩展 */
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

const FONT_FAMILIES = [
  "Helvetica",
  "Arial",
  "Inter",
  "Segoe UI",
  "Times New Roman",
  "Courier New",
  "Georgia",
  "Verdana",
  "宋体",
  "黑体",
  "微软雅黑",
];

const FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72,
];

/** 单条配色预设：点击后一次性套用「填充 + 描边」（可选附带竖向渐变） */
interface StylePreset {
  /** 填充色 */
  fill: string;
  /** 描边色，同时用作色块边框色 */
  stroke: string;
  /** 渐变色；不设表示纯色填充 */
  gradient?: string;
  /** 无填充：写入 fillColor=none，色块渲染成棋盘格 */
  noFill?: boolean;
}

/** 配色轮播每页的色块数（4 列 × 2 行） */
const STYLE_PRESET_PER_PAGE = 8;

/**
 * 「样式」Tab 顶部的配色轮播：6 页 × 8 组 = 48 组预设。
 *
 * 色值与顺序按 draw.io 官方样式面板逐像素还原（参考截图 6 张）：
 * 1) 默认浅色  2) 饱和彩色  3) 暖色/深色  4) 粉彩（含「无填充」）
 * 5) 竖向渐变  6) 柔和低饱和
 */
const STYLE_PRESET_PAGES: StylePreset[][] = [
  [
    { fill: "#ffffff", stroke: "#000000" },
    { fill: "#f5f5f5", stroke: "#666666" },
    { fill: "#dae8fc", stroke: "#6c8ebf" },
    { fill: "#d5e8d4", stroke: "#82b366" },
    { fill: "#ffe6cc", stroke: "#d79b00" },
    { fill: "#fff2cc", stroke: "#d6b656" },
    { fill: "#f8cecc", stroke: "#b85450" },
    { fill: "#e1d5e7", stroke: "#9673a6" },
  ],
  [
    { fill: "#ffffff", stroke: "#000000" },
    { fill: "#60a917", stroke: "#2d7600" },
    { fill: "#008a00", stroke: "#005700" },
    { fill: "#1ba1e2", stroke: "#006eaf" },
    { fill: "#0050ef", stroke: "#001dbc" },
    { fill: "#6a00ff", stroke: "#3700cc" },
    { fill: "#d80073", stroke: "#a50040" },
    { fill: "#a20025", stroke: "#6f0000" },
  ],
  [
    { fill: "#e51400", stroke: "#b20000" },
    { fill: "#fa6800", stroke: "#c73500" },
    { fill: "#f0a30a", stroke: "#bd7000" },
    { fill: "#e3c800", stroke: "#b09500" },
    { fill: "#6d8764", stroke: "#3a5431" },
    { fill: "#647687", stroke: "#314354" },
    { fill: "#76608a", stroke: "#432d57" },
    { fill: "#a0522d", stroke: "#6d1f00" },
  ],
  [
    { fill: "#ffffff", stroke: "#000000" },
    { fill: "#ffffff", stroke: "#000000", noFill: true },
    { fill: "#fad7ac", stroke: "#b46504" },
    { fill: "#fad9d5", stroke: "#ae4132" },
    { fill: "#b0e3e6", stroke: "#0e8088" },
    { fill: "#b1ddf0", stroke: "#10739e" },
    { fill: "#d0cee2", stroke: "#56517e" },
    { fill: "#bac8d3", stroke: "#23445d" },
  ],
  [
    { fill: "#ffffff", stroke: "#000000" },
    { fill: "#f6f6f6", stroke: "#666666", gradient: "#b0b0b0" },
    { fill: "#dce9fc", stroke: "#6c8ebf", gradient: "#79a2df" },
    { fill: "#d6e8d5", stroke: "#82b366", gradient: "#94cf72" },
    { fill: "#ffce29", stroke: "#d79b00", gradient: "#ffa300" },
    { fill: "#fff3ce", stroke: "#d6b656", gradient: "#ffd861" },
    { fill: "#f8d0ce", stroke: "#b85450", gradient: "#e96661" },
    { fill: "#e6d1df", stroke: "#996185", gradient: "#d46e99" },
  ],
  [
    { fill: "#ffffff", stroke: "#000000" },
    { fill: "#eeeeee", stroke: "#36393d" },
    { fill: "#f9f7ed", stroke: "#36393d" },
    { fill: "#ffcc99", stroke: "#36393d" },
    { fill: "#cce5ff", stroke: "#36393d" },
    { fill: "#ffff88", stroke: "#36393d" },
    { fill: "#cdeb8b", stroke: "#36393d" },
    { fill: "#ffcccc", stroke: "#36393d" },
  ],
];

export class FormatPanel {
  private root: HTMLElement;
  private graph: any;
  private onChange: () => void;
  private currentCells: any[] = [];
  private currentStyle: any = {};
  private MxUtils: any;
  private MxConstants: any;
  private bottomActions!: HTMLElement;

  // 样式 Tab
  private styleGrid!: HTMLElement;
  private stylePrevBtn!: HTMLButtonElement;
  private styleNextBtn!: HTMLButtonElement;
  private styleDots: HTMLButtonElement[] = [];
  private stylePageIndex = 0;
  /** 当前图形命中的预设全局序号（跨页，-1 = 未命中任何预设） */
  private activePresetIndex = -1;
  private fillCheck!: HTMLInputElement;
  private fillColor!: HTMLElement;
  private gradientCheck!: HTMLInputElement;
  private gradientDirection!: HTMLSelectElement;
  private gradientColor!: HTMLElement;
  private strokeCheck!: HTMLInputElement;
  private strokeColor!: HTMLElement;
  private lineType!: HTMLElement;
  private strokeWidth!: HTMLElement;
  private styleOpacity!: HTMLElement;
  private roundedCheck!: HTMLInputElement;
  private sketchCheck!: HTMLInputElement;
  private glassCheck!: HTMLInputElement;
  private shadowCheck!: HTMLInputElement;
  // 文本 Tab
  private fontFamily!: HTMLSelectElement;
  private fontSize!: HTMLSelectElement;
  private boldBtn!: HTMLButtonElement;
  private italicBtn!: HTMLButtonElement;
  private underlineBtn!: HTMLButtonElement;
  private strikeBtn!: HTMLButtonElement;
  private alignBtns: Record<string, HTMLButtonElement> = {};
  private valignBtns: Record<string, HTMLButtonElement> = {};
  private writingDir!: HTMLSelectElement;
  private fontColor!: HTMLElement;
  private textBgColor!: HTMLElement;
  private textBorderColor!: HTMLElement;
  private wrapCheck!: HTMLInputElement;
  private htmlCheck!: HTMLInputElement;
  private textOpacity!: HTMLElement;
  // 排列 Tab
  private widthInput!: HTMLElement;
  private heightInput!: HTMLElement;
  private lockRatio!: HTMLInputElement;
  private leftInput!: HTMLElement;
  private topInput!: HTMLElement;
  private rotationInput!: HTMLElement;
  private lockBtn!: HTMLButtonElement;
  private groupBtn!: HTMLButtonElement;

  private origRatio = 1;

  constructor(root: HTMLElement, graph: any, onChange: () => void) {
    this.root = root;
    this.graph = graph;
    this.onChange = onChange;
    this.MxUtils = mxUtils();
    this.MxConstants = mxConstants();
    this.build();
  }

  // ---------- 构建 DOM ----------

  private build(): void {
    this.root.empty();

    // Tab 导航（v0.11.2 起去掉了「格式」标题头与折叠/关闭两个图标按钮，
    // Tab 行直接作为面板第一行；关闭面板仍可通过清空选中或「排列」Tab 的删除完成）
    const tabs = h("div", "drawio-fmt-tabs");
    const tabDefs = [
      { id: "style", label: t("format.tab.style") },
      { id: "text", label: t("format.tab.text") },
      { id: "arrange", label: t("format.tab.arrange") },
    ];
    for (const def of tabDefs) {
      const tab = h("button", "drawio-fmt-tab", def.label);
      tab.dataset.tab = def.id;
      if (def.id === "style") tab.classList.add("active");
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
        this.bottomActions.style.display =
          def.id === "style" ? "flex" : "none";
      });
      tabs.appendChild(tab);
    }
    this.root.appendChild(tabs);

    // 内容区
    const body = h("div", "drawio-fmt-body");
    body.appendChild(this.buildStylePane());
    body.appendChild(this.buildTextPane());
    body.appendChild(this.buildArrangePane());
    this.root.appendChild(body);

    // 底部按钮（仅在「样式」Tab 显示）
    const bottom = h("div", "drawio-fmt-bottom");
    this.bottomActions = bottom;
    const editBtn = h("button", "drawio-fmt-bottom-btn", t("format.edit"));
    editBtn.addEventListener("click", () => {
      if (this.currentCells.length > 0) {
        this.graph.startEditingAtCell(this.currentCells[0]);
      }
    });
    const copyBtn = h("button", "drawio-fmt-bottom-btn", t("format.copyStyle"));
    copyBtn.addEventListener("click", () => this.copyStyle());
    const defaultBtn = h(
      "button",
      "drawio-fmt-bottom-btn",
      t("format.setAsDefault")
    );
    defaultBtn.addEventListener("click", () => this.setAsDefaultStyle());
    bottom.appendChild(editBtn);
    bottom.appendChild(copyBtn);
    bottom.appendChild(defaultBtn);
    this.root.appendChild(bottom);
  }

  private buildStylePane(): HTMLElement {
    const pane = h("div", "drawio-fmt-tabpane active");
    pane.dataset.pane = "style";

    // 配色轮播：左右箭头 + 4×2 单色块 + 分页圆点
    pane.appendChild(this.buildStylePalette());

    // 填充：改用「分割线 + 内容」的扁平分组，不再渲染可折叠的「填充」标题栏
    pane.appendChild(
      this.flatSection((body) => {
        const row = h("div", "drawio-fmt-row");
        this.fillCheck = h("input") as HTMLInputElement;
        this.fillCheck.type = "checkbox";
        this.fillCheck.checked = true;
        const lbl = h("label", "drawio-fmt-check");
        lbl.appendChild(this.fillCheck);
        lbl.appendChild(h("span", undefined, t("format.fill")));
        row.appendChild(lbl);
        this.fillColor = this.colorField("#ffffff", (hex) => {
          if (this.fillCheck.checked)
            this.applyStyle(this.MxConstants.STYLE_FILLCOLOR, hex);
        });
        row.appendChild(this.fillColor);
        this.fillCheck.addEventListener("change", () => {
          this.applyStyle(
            this.MxConstants.STYLE_FILLCOLOR,
            this.fillCheck.checked ? this.hexOf(this.fillColor) : "none"
          );
        });
        body.appendChild(row);

        // 渐变
        const gradRow = h("div", "drawio-fmt-row");
        this.gradientCheck = h("input") as HTMLInputElement;
        this.gradientCheck.type = "checkbox";
        this.gradientCheck.checked = false;
        const gradLbl = h("label", "drawio-fmt-check");
        gradLbl.appendChild(this.gradientCheck);
        gradLbl.appendChild(h("span", undefined, t("format.gradient")));
        gradRow.appendChild(gradLbl);
        this.gradientDirection = this.selectField(
          [
            { v: this.MxConstants.DIRECTION_SOUTH, t: t("format.gradientDown") },
            { v: this.MxConstants.DIRECTION_NORTH, t: t("format.gradientUp") },
            { v: this.MxConstants.DIRECTION_WEST, t: t("format.gradientLeft") },
            { v: this.MxConstants.DIRECTION_EAST, t: t("format.gradientRight") },
          ],
          this.MxConstants.DIRECTION_SOUTH,
          (v) => {
            if (this.gradientCheck.checked)
              this.applyStyle(this.MxConstants.STYLE_GRADIENT_DIRECTION, v);
          }
        );
        gradRow.appendChild(this.gradientDirection);
        this.gradientColor = this.colorField("#000000", (hex) => {
          if (this.gradientCheck.checked)
            this.applyStyle(this.MxConstants.STYLE_GRADIENTCOLOR, hex);
        });
        gradRow.appendChild(this.gradientColor);
        this.gradientCheck.addEventListener("change", () => {
          const on = this.gradientCheck.checked;
          this.gradientDirection.disabled = !on;
          (this.gradientColor as any)._input.disabled = !on;
          this.applyStyle(
            this.MxConstants.STYLE_GRADIENTCOLOR,
            on ? this.hexOf(this.gradientColor) : null
          );
          if (on) {
            this.applyStyle(
              this.MxConstants.STYLE_GRADIENT_DIRECTION,
              this.gradientDirection.value
            );
          } else {
            this.applyStyle(this.MxConstants.STYLE_GRADIENT_DIRECTION, null);
          }
        });
        body.appendChild(gradRow);
      })
    );

    // 线条：同样只留一条分割线，标题由下面勾选框的「线条」二字承担
    pane.appendChild(
      this.flatSection((body) => {
        const row1 = h("div", "drawio-fmt-row");
        this.strokeCheck = h("input") as HTMLInputElement;
        this.strokeCheck.type = "checkbox";
        this.strokeCheck.checked = true;
        const lbl = h("label", "drawio-fmt-check");
        lbl.appendChild(this.strokeCheck);
        lbl.appendChild(h("span", undefined, t("format.stroke")));
        row1.appendChild(lbl);
        this.strokeColor = this.colorField("#000000", (hex) => {
          if (this.strokeCheck.checked)
            this.applyStyle(this.MxConstants.STYLE_STROKECOLOR, hex);
        });
        row1.appendChild(this.strokeColor);
        this.strokeCheck.addEventListener("change", () => {
          this.applyStyle(
            this.MxConstants.STYLE_STROKECOLOR,
            this.strokeCheck.checked ? this.hexOf(this.strokeColor) : "none"
          );
        });
        body.appendChild(row1);

        const row2 = h("div", "drawio-fmt-row");
        const lineStyles = [
          { v: "solid", dash: null as string | null },
          { v: "dashed", dash: "6 4" },
          { v: "dotted", dash: "1 3" },
          { v: "dashDot", dash: "6 2 1 2" },
          { v: "dashDotDot", dash: "6 2 1 2 1 2" },
        ];
        this.lineType = this.lineStyleField(
          lineStyles,
          "solid",
          (v) => {
            if (v === "solid") {
              this.applyStyle(this.MxConstants.STYLE_DASHED, null);
              this.applyStyle(this.MxConstants.STYLE_FIX_DASH, null);
              this.applyStyle(this.MxConstants.STYLE_DASH_PATTERN, null);
            } else {
              const opt = lineStyles.find((o) => o.v === v);
              this.applyStyle(this.MxConstants.STYLE_DASHED, "1");
              this.applyStyle(this.MxConstants.STYLE_FIX_DASH, "1");
              this.applyStyle(
                this.MxConstants.STYLE_DASH_PATTERN,
                opt?.dash ?? "3 3"
              );
            }
          }
        );
        row2.appendChild(this.lineType);
        this.strokeWidth = this.numberField("pt", "1", (v) =>
          this.applyStyle(this.MxConstants.STYLE_STROKEWIDTH, String(v))
        );
        row2.appendChild(this.strokeWidth);
        body.appendChild(row2);

        // 不透明度：并入线条组（与 draw.io 一致）。
        // 它同时让 row2 不再是末行，从而保住 .drawio-fmt-row 的 10px 行距——
        // 否则 row2 命中 :last-child 归零，不透明度会与线型控制贴在一起。
        const opRow = h("div", "drawio-fmt-row");
        opRow.appendChild(h("span", "drawio-fmt-label", t("format.opacity")));
        this.styleOpacity = this.numberField("%", "100", (v) =>
          this.applyStyle(
            this.MxConstants.STYLE_OPACITY,
            String(Math.min(100, Math.max(0, v)))
          )
        );
        opRow.appendChild(this.styleOpacity);
        body.appendChild(opRow);
      })
    );

    // 效果：同样只留一条分割线（draw.io 这一组本来也不带标题栏）
    pane.appendChild(
      this.flatSection((body) => {
        const grid = h("div", "drawio-fmt-effects-grid");
        // 标题栏去掉后「效果」二字就没地方显示了，用 role=group + aria-label 把语义留给读屏
        grid.setAttribute("role", "group");
        grid.setAttribute("aria-label", t("format.effects"));
        const mkCheck = (label: string, key: string) => {
          const check = h("input") as HTMLInputElement;
          check.type = "checkbox";
          const lbl = h("label", "drawio-fmt-check");
          lbl.appendChild(check);
          lbl.appendChild(h("span", undefined, label));
          check.addEventListener("change", () =>
            this.applyStyle(key, check.checked ? "1" : null)
          );
          grid.appendChild(lbl);
          return check;
        };
        this.roundedCheck = mkCheck(
          t("format.rounded"),
          this.MxConstants.STYLE_ROUNDED
        );
        this.sketchCheck = mkCheck(t("format.sketch"), "sketch");
        this.glassCheck = mkCheck(
          t("format.glass"),
          this.MxConstants.STYLE_GLASS
        );
        this.shadowCheck = mkCheck(
          t("format.shadow"),
          this.MxConstants.STYLE_SHADOW
        );
        body.appendChild(grid);
      })
    );

    return pane;
  }

  // ---------- 配色轮播 ----------

  /** 构建「左右箭头 + 4×2 色块 + 分页圆点」整块，并渲染首页 */
  private buildStylePalette(): HTMLElement {
    const wrap = h("div", "drawio-fmt-palette");

    const pager = h("div", "drawio-fmt-stylepager");

    this.stylePrevBtn = this.pagerButton("M15 5 8 12l7 7", t("format.palettePrev"));
    this.stylePrevBtn.addEventListener("click", () => this.changeStylePage(-1));
    pager.appendChild(this.stylePrevBtn);

    this.styleGrid = h("div", "drawio-fmt-style-grid");
    pager.appendChild(this.styleGrid);

    this.styleNextBtn = this.pagerButton("M9 5l7 7-7 7", t("format.paletteNext"));
    this.styleNextBtn.addEventListener("click", () => this.changeStylePage(1));
    pager.appendChild(this.styleNextBtn);

    wrap.appendChild(pager);

    // 分页圆点（可点跳页；与参考图外观一致，只是多了可点）
    const dots = h("div", "drawio-fmt-style-dots");
    STYLE_PRESET_PAGES.forEach((_, i) => {
      const dot = h("button", "drawio-fmt-style-dot") as HTMLButtonElement;
      dot.title = t("format.palettePage", { n: String(i + 1) });
      dot.setAttribute("aria-label", t("format.palettePage", { n: String(i + 1) }));
      dot.addEventListener("click", () => this.setStylePage(i));
      dots.appendChild(dot);
      this.styleDots.push(dot);
    });
    wrap.appendChild(dots);

    this.renderStylePage();
    return wrap;
  }

  /** 一个纯图标的翻页按钮（挂 clickable-icon，避开 Obsidian 的按钮默认样式） */
  private pagerButton(d: string, label: string): HTMLButtonElement {
    const b = h(
      "button",
      "drawio-fmt-pager-btn clickable-icon"
    ) as HTMLButtonElement;
    b.title = label;
    b.setAttribute("aria-label", label);
    const svg = b.createSvg("svg", {
      attr: {
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    });
    svg.createSvg("path", { attr: { d } });
    return b;
  }

  /** 渲染当前页的 8 个色块 */
  private renderStylePage(): void {
    const page = STYLE_PRESET_PAGES[this.stylePageIndex] ?? [];
    this.styleGrid.empty();
    page.forEach((preset, i) => {
      const index = this.stylePageIndex * STYLE_PRESET_PER_PAGE + i;
      const sw = h("button", "drawio-fmt-swatch") as HTMLButtonElement;
      sw.dataset.presetIndex = String(index);
      sw.title = this.presetTooltip(preset);
      sw.setAttribute("aria-label", sw.title);
      this.paintSwatch(sw, preset);
      if (index === this.activePresetIndex) sw.classList.add("active");
      sw.addEventListener("click", () => this.applyStylePreset(preset, index));
      this.styleGrid.appendChild(sw);
    });
    this.updateStyleDots();
  }

  /** 色块上色：纯色 / 竖向渐变 / 无填充棋盘格 */
  private paintSwatch(sw: HTMLElement, preset: StylePreset): void {
    // 无填充时留空串，让 .is-none 的棋盘格透出来
    // （统一赋「变量」而不是给两个分支各写一次字面量）
    const bg = preset.noFill
      ? ""
      : preset.gradient
        ? `linear-gradient(180deg, ${preset.fill} 0%, ${preset.gradient} 100%)`
        : preset.fill;
    sw.classList.toggle("is-none", !!preset.noFill);
    sw.style.background = bg;
    sw.style.borderColor = preset.stroke;
  }

  private presetTooltip(preset: StylePreset): string {
    const fill = preset.noFill
      ? t("format.presetNone")
      : preset.gradient
        ? `${preset.fill} → ${preset.gradient}`
        : preset.fill;
    return t("format.presetTooltip", { fill, stroke: preset.stroke });
  }

  private updateStyleDots(): void {
    this.styleDots.forEach((dot, i) =>
      dot.classList.toggle("active", i === this.stylePageIndex)
    );
  }

  /** 循环翻页（末页点右回到首页） */
  private changeStylePage(delta: number): void {
    this.setStylePage(this.stylePageIndex + delta);
  }

  private setStylePage(page: number): void {
    const total = STYLE_PRESET_PAGES.length;
    this.stylePageIndex = ((page % total) + total) % total;
    this.renderStylePage();
  }

  /**
   * 找出与当前样式完全一致（填充 + 描边 + 渐变色）的预设，返回全局序号；未命中返回 -1。
   *
   * 优先在**当前可见页**里找：像 #ffffff/#000000 这种在 5 页里都出现的预设，
   * 若一律返回首页会让面板无谓地跳页。当前页没有才回退到全局首个匹配。
   * 注意 mxGraph 会把纯数值样式值读成 number，这里统一转字符串比较。
   */
  private matchStylePreset(fill: any, stroke: any, gradient: any): number {
    const norm = (v: any) =>
      v == null || v === this.MxConstants.NONE ? "none" : String(v).toLowerCase();
    const f = norm(fill);
    const s = norm(stroke);
    const g = norm(gradient);

    const hit = (preset: StylePreset) =>
      norm(preset.noFill ? "none" : preset.fill) === f &&
      norm(preset.stroke) === s &&
      norm(preset.gradient) === g;

    const current = STYLE_PRESET_PAGES[this.stylePageIndex] ?? [];
    const localIndex = current.findIndex(hit);
    if (localIndex >= 0) {
      return this.stylePageIndex * STYLE_PRESET_PER_PAGE + localIndex;
    }

    for (let p = 0; p < STYLE_PRESET_PAGES.length; p++) {
      const index = STYLE_PRESET_PAGES[p].findIndex(hit);
      if (index >= 0) return p * STYLE_PRESET_PER_PAGE + index;
    }
    return -1;
  }

  /** 按当前样式同步轮播：命中就翻到那一页并高亮，未命中则清空高亮 */
  private syncStylePalette(fill: any, stroke: any, gradient: any): void {
    const index = this.matchStylePreset(fill, stroke, gradient);
    this.setActivePreset(index);
    if (index >= 0) {
      const page = Math.floor(index / STYLE_PRESET_PER_PAGE);
      if (page !== this.stylePageIndex) this.setStylePage(page);
    }
  }

  private setActivePreset(index: number): void {
    this.activePresetIndex = index;
    this.styleGrid
      .querySelectorAll(".drawio-fmt-swatch")
      .forEach((el) =>
        el.classList.toggle(
          "active",
          (el as HTMLElement).dataset.presetIndex === String(index)
        )
      );
  }

  /** 点色块：一次性写入 填充 + 描边（+ 渐变色），并回填下方控件 */
  private applyStylePreset(preset: StylePreset, index: number): void {
    // 无选中时 applyStyle 会静默早退，这里也提前返回，避免控件状态「自己骗自己」
    if (!this.graph || this.currentCells.length === 0) return;

    this.applyStyle(
      this.MxConstants.STYLE_FILLCOLOR,
      preset.noFill ? "none" : preset.fill
    );
    this.applyStyle(this.MxConstants.STYLE_STROKECOLOR, preset.stroke);

    // 纯色预设要顺手清掉可能存在的旧渐变，否则样式与色块对不上
    if (preset.gradient) {
      this.applyStyle(this.MxConstants.STYLE_GRADIENTCOLOR, preset.gradient);
      this.applyStyle(
        this.MxConstants.STYLE_GRADIENT_DIRECTION,
        this.MxConstants.DIRECTION_SOUTH
      );
    } else {
      this.applyStyle(this.MxConstants.STYLE_GRADIENTCOLOR, null);
      this.applyStyle(this.MxConstants.STYLE_GRADIENT_DIRECTION, null);
    }

    this.fillCheck.checked = !preset.noFill;
    this.strokeCheck.checked = true;
    this.setColorBlock(this.fillColor, preset.noFill ? "#ffffff" : preset.fill);
    this.setColorBlock(this.strokeColor, preset.stroke);

    const gradOn = !!preset.gradient;
    this.gradientCheck.checked = gradOn;
    this.gradientDirection.disabled = !gradOn;
    (this.gradientColor as any)._input.disabled = !gradOn;
    if (gradOn) {
      this.setColorBlock(this.gradientColor, preset.gradient as string);
      this.gradientDirection.value = this.MxConstants.DIRECTION_SOUTH;
    }

    // 刚点过的那一组就是当前真相，立刻高亮（refresh 要等下次选中才会跑）
    this.setActivePreset(index);
  }

  private buildTextPane(): HTMLElement {
    const pane = h("div", "drawio-fmt-tabpane");
    pane.dataset.pane = "text";

    const fontRow = h("div", "drawio-fmt-row");
    this.fontFamily = this.selectField(
      FONT_FAMILIES.map((f) => ({ v: f, t: f })),
      "Helvetica",
      (v) => this.applyStyle(this.MxConstants.STYLE_FONTFAMILY, v)
    );
    fontRow.appendChild(this.fontFamily);
    pane.appendChild(fontRow);

    const styleRow = h("div", "drawio-fmt-toolbar");
    this.boldBtn = this.toggleBtn("B", "bold", true, (on) =>
      this.setFontStyle(this.MxConstants.FONT_BOLD, on)
    );
    this.italicBtn = this.toggleBtn("I", "italic", false, (on) =>
      this.setFontStyle(this.MxConstants.FONT_ITALIC, on)
    );
    this.underlineBtn = this.toggleBtn("U", "underline", false, (on) =>
      this.setFontStyle(this.MxConstants.FONT_UNDERLINE, on)
    );
    this.strikeBtn = this.toggleBtn("S", "strike", false, (on) =>
      this.setFontStyle(this.MxConstants.FONT_STRIKETHROUGH, on)
    );
    styleRow.appendChild(this.boldBtn);
    styleRow.appendChild(this.italicBtn);
    styleRow.appendChild(this.underlineBtn);
    styleRow.appendChild(this.strikeBtn);
    this.fontSize = this.selectField(
      FONT_SIZES.map((s) => ({ v: String(s), t: `${s} px` })),
      "12",
      (v) => this.applyStyle(this.MxConstants.STYLE_FONTSIZE, v)
    );
    styleRow.appendChild(this.fontSize);
    pane.appendChild(styleRow);

    const alignRow = h("div", "drawio-fmt-toolbar");
    const aligns: Array<[string, string, string]> = [
      ["left", "l", "M4 6h16M4 12h10M4 18h14"],
      ["center", "c", "M4 6h16M7 12h10M5 18h14"],
      ["right", "r", "M4 6h16M10 12h10M6 18h14"],
    ];
    for (const [k, icon, d] of aligns) {
      const b = this.iconToggleBtn(icon, d, false, () => {
        this.applyStyle(this.MxConstants.STYLE_ALIGN, k);
        Object.values(this.alignBtns).forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });
      this.alignBtns[k] = b;
      alignRow.appendChild(b);
    }
    const valigns: Array<[string, string, string]> = [
      ["top", "t", "M6 4v16M12 4v10M18 4v16"],
      ["middle", "m", "M6 4v16M12 7v10M18 4v16"],
      ["bottom", "b", "M6 4v16M12 10v10M18 4v16"],
    ];
    for (const [k, icon, d] of valigns) {
      const b = this.iconToggleBtn(icon, d, false, () => {
        this.applyStyle(this.MxConstants.STYLE_VERTICAL_ALIGN, k);
        Object.values(this.valignBtns).forEach((x) =>
          x.classList.remove("active")
        );
        b.classList.add("active");
      });
      this.valignBtns[k] = b;
      alignRow.appendChild(b);
    }
    pane.appendChild(alignRow);

    const wdRow = h("div", "drawio-fmt-row");
    wdRow.appendChild(h("span", "drawio-fmt-label", t("format.position")));
    this.writingDir = this.selectField(
      [
        { v: "auto", t: t("format.posCenterH") },
        { v: "left", t: t("format.posLeft") },
        { v: "right", t: t("format.posRight") },
      ],
      "auto",
      (v) => {
        const map: Record<string, string> = {
          auto: this.MxConstants.ALIGN_CENTER,
          left: this.MxConstants.ALIGN_LEFT,
          right: this.MxConstants.ALIGN_RIGHT,
        };
        this.applyAlign(map[v]);
      }
    );
    wdRow.appendChild(this.writingDir);
    pane.appendChild(wdRow);

    const wdRow2 = h("div", "drawio-fmt-row");
    wdRow2.appendChild(h("span", "drawio-fmt-label", t("format.writingDir")));
    const dirSel = this.selectField(
      [
        { v: "auto", t: t("format.dirAuto") },
        { v: "h", t: t("format.dirH") },
        { v: "v", t: t("format.dirV") },
      ],
      "auto",
      (v) => {
        if (v === "v")
          this.applyStyle(this.MxConstants.STYLE_HORIZONTAL, "0");
        else this.applyStyle(this.MxConstants.STYLE_HORIZONTAL, null);
      }
    );
    wdRow2.appendChild(dirSel);
    pane.appendChild(wdRow2);

    const fcRow = h("div", "drawio-fmt-row");
    const fcLbl = h("label", "drawio-fmt-check");
    const fcChk = h("input") as HTMLInputElement;
    fcChk.type = "checkbox";
    fcChk.checked = true;
    fcLbl.appendChild(fcChk);
    fcLbl.appendChild(h("span", undefined, t("format.fontColor")));
    fcRow.appendChild(fcLbl);
    this.fontColor = this.colorField("#000000", (hex) =>
      this.applyStyle(this.MxConstants.STYLE_FONTCOLOR, hex)
    );
    fcRow.appendChild(this.fontColor);
    pane.appendChild(fcRow);

    const bgRow = h("div", "drawio-fmt-row");
    const bgLbl = h("label", "drawio-fmt-check");
    const bgChk = h("input") as HTMLInputElement;
    bgChk.type = "checkbox";
    bgLbl.appendChild(bgChk);
    bgLbl.appendChild(h("span", undefined, t("format.bgColor")));
    bgRow.appendChild(bgLbl);
    this.textBgColor = this.colorField("#ffffff", (hex) =>
      this.applyStyle(this.MxConstants.STYLE_LABEL_BACKGROUNDCOLOR, hex)
    );
    bgRow.appendChild(this.textBgColor);
    pane.appendChild(bgRow);

    const bcRow = h("div", "drawio-fmt-row");
    const bcLbl = h("label", "drawio-fmt-check");
    const bcChk = h("input") as HTMLInputElement;
    bcChk.type = "checkbox";
    bcLbl.appendChild(bcChk);
    bcLbl.appendChild(h("span", undefined, t("format.borderColor")));
    bcRow.appendChild(bcLbl);
    this.textBorderColor = this.colorField("#ffffff", (hex) =>
      this.applyStyle(this.MxConstants.STYLE_LABEL_BORDERCOLOR, hex)
    );
    bcRow.appendChild(this.textBorderColor);
    pane.appendChild(bcRow);

    pane.appendChild(h("div", "drawio-fmt-divider"));

    const wrapRow = h("div", "drawio-fmt-row");
    this.wrapCheck = h("input") as HTMLInputElement;
    this.wrapCheck.type = "checkbox";
    this.wrapCheck.checked = true;
    const wrapLbl = h("label", "drawio-fmt-check");
    wrapLbl.appendChild(this.wrapCheck);
    wrapLbl.appendChild(h("span", undefined, t("format.wordWrap")));
    this.wrapCheck.addEventListener("change", () =>
      this.applyStyle(
        this.MxConstants.STYLE_WHITE_SPACE,
        this.wrapCheck.checked ? this.MxConstants.WORD_WRAP : null
      )
    );
    wrapRow.appendChild(wrapLbl);
    pane.appendChild(wrapRow);

    const htmlRow = h("div", "drawio-fmt-row");
    this.htmlCheck = h("input") as HTMLInputElement;
    this.htmlCheck.type = "checkbox";
    this.htmlCheck.checked = true;
    const htmlLbl = h("label", "drawio-fmt-check");
    htmlLbl.appendChild(this.htmlCheck);
    htmlLbl.appendChild(h("span", undefined, t("format.formattedText")));
    this.htmlCheck.addEventListener("change", () =>
      this.applyStyle(
        this.MxConstants.STYLE_HTML,
        this.htmlCheck.checked ? "1" : null
      )
    );
    htmlRow.appendChild(htmlLbl);
    pane.appendChild(htmlRow);

    const opRow = h("div", "drawio-fmt-row");
    opRow.appendChild(h("span", "drawio-fmt-label", t("format.opacity")));
    this.textOpacity = this.numberField("%", "100", (v) =>
      this.applyStyle(
        this.MxConstants.STYLE_TEXT_OPACITY,
        String(Math.min(100, Math.max(0, v)))
      )
    );
    opRow.appendChild(this.textOpacity);
    pane.appendChild(opRow);

    pane.appendChild(
      this.section(
        t("format.spacing"),
        (body) => {
          body.appendChild(
            h("div", "drawio-fmt-muted", t("format.spacingPlaceholder"))
          );
        },
        false
      )
    );

    return pane;
  }

  private buildArrangePane(): HTMLElement {
    const pane = h("div", "drawio-fmt-tabpane");
    pane.dataset.pane = "arrange";

    const grid = h("div", "drawio-fmt-arrange-grid");
    const mk = (label: string, fn: () => void) => {
      const b = h("button", "drawio-fmt-arrange-btn", label);
      b.addEventListener("click", fn);
      return b;
    };
    grid.appendChild(mk(t("format.toFront"), () => this.graph.bringToFront(this.currentCells)));
    grid.appendChild(mk(t("format.toBack"), () => this.graph.sendToBack(this.currentCells)));
    grid.appendChild(
      mk(t("format.forward"), () => this.graph.orderCells(false, this.currentCells))
    );
    grid.appendChild(
      mk(t("format.backward"), () => this.graph.orderCells(true, this.currentCells))
    );
    pane.appendChild(grid);

    pane.appendChild(
      this.section(
        t("format.sizePosition"),
        (body) => {
          const sizeRow = h("div", "drawio-fmt-row");
          sizeRow.appendChild(h("span", "drawio-fmt-label-wide", t("format.size")));
          this.widthInput = this.numberField("pt", "80", (v) => {
            this.applyGeometry((g) => {
              g.width = v;
              if (this.lockRatio.checked && this.origRatio)
                g.height = Math.round(v / this.origRatio);
            });
          });
          this.heightInput = this.numberField("pt", "80", (v) => {
            this.applyGeometry((g) => {
              g.height = v;
              if (this.lockRatio.checked && this.origRatio)
                g.width = Math.round(v * this.origRatio);
            });
          });
          sizeRow.appendChild(this.widthInput);
          sizeRow.appendChild(this.heightInput);
          body.appendChild(sizeRow);

          const ratioRow = h("div", "drawio-fmt-row");
          this.lockRatio = h("input") as HTMLInputElement;
          this.lockRatio.type = "checkbox";
          this.lockRatio.checked = true;
          const rl = h("label", "drawio-fmt-check");
          rl.appendChild(this.lockRatio);
          rl.appendChild(h("span", undefined, t("format.lockRatio")));
          ratioRow.appendChild(rl);
          body.appendChild(ratioRow);

          const posRow = h("div", "drawio-fmt-row");
          posRow.appendChild(h("span", "drawio-fmt-label-wide", t("format.position")));
          this.leftInput = this.numberField("pt", "0", (v) =>
            this.applyGeometry((g) => (g.x = v))
          );
          this.topInput = this.numberField("pt", "0", (v) =>
            this.applyGeometry((g) => (g.y = v))
          );
          posRow.appendChild(this.leftInput);
          posRow.appendChild(this.topInput);
          body.appendChild(posRow);
        },
        true
      )
    );

    pane.appendChild(
      this.section(
        t("format.rotation"),
        (body) => {
          const rRow = h("div", "drawio-fmt-row");
          this.rotationInput = this.numberField("°", "0", (v) =>
            this.applyStyle(this.MxConstants.STYLE_ROTATION, String(v))
          );
          rRow.appendChild(this.rotationInput);
          body.appendChild(rRow);
        },
        false
      )
    );

    pane.appendChild(
      this.section(
        t("format.flip"),
        (body) => {
          const fg = h("div", "drawio-fmt-arrange-grid");
          const flipH = h("button", "drawio-fmt-arrange-btn", t("format.flipH"));
          flipH.addEventListener("click", () =>
            this.toggleFlip(this.MxConstants.STYLE_FLIPH)
          );
          const flipV = h("button", "drawio-fmt-arrange-btn", t("format.flipV"));
          flipV.addEventListener("click", () =>
            this.toggleFlip(this.MxConstants.STYLE_FLIPV)
          );
          fg.appendChild(flipH);
          fg.appendChild(flipV);
          body.appendChild(fg);
        },
        false
      )
    );

    const gridRow = h("div", "drawio-fmt-row");
    const gridBtn = h(
      "button",
      "drawio-fmt-arrange-btn drawio-fmt-block",
      t("format.alignToGrid")
    );
    gridBtn.addEventListener("click", () => this.graph.alignCells(this.MxConstants.ALIGN_CENTER, this.currentCells));
    gridRow.appendChild(gridBtn);
    pane.appendChild(gridRow);

    const stack = h("div", "drawio-fmt-stack");
    this.groupBtn = h("button", "drawio-fmt-arrange-btn", t("format.group")) as HTMLButtonElement;
    this.groupBtn.addEventListener("click", () => {
      if (this.currentCells.length > 1) this.graph.groupCells(null, 0, this.currentCells);
      this.refresh(this.currentCells);
    });
    const ungroupBtn = h("button", "drawio-fmt-arrange-btn", t("format.ungroup"));
    ungroupBtn.addEventListener("click", () => {
      this.graph.ungroupCells(this.currentCells);
      this.refresh(this.currentCells);
    });
    this.lockBtn = h("button", "drawio-fmt-arrange-btn", t("format.lock")) as HTMLButtonElement;
    this.lockBtn.addEventListener("click", () => {
      const locked = this.MxUtils.getValue(this.currentStyle, this.MxConstants.STYLE_LOCKED, "0") === "1";
      this.applyStyle(this.MxConstants.STYLE_LOCKED, locked ? null : "1");
      this.refresh(this.currentCells);
    });
    const delBtn = h("button", "drawio-fmt-arrange-btn", t("format.delete"));
    delBtn.addEventListener("click", () => {
      this.graph.removeCells(this.currentCells);
      this.hide();
    });
    stack.appendChild(this.groupBtn);
    stack.appendChild(ungroupBtn);
    stack.appendChild(this.lockBtn);
    stack.appendChild(delBtn);
    pane.appendChild(stack);

    return pane;
  }

  // ---------- 通用控件构造 ----------

  /**
   * 扁平分组：只用一条分割线与上方内容分隔，没有标题栏、也不可折叠。
   * 「填充 / 渐变」用它代替原来的折叠标题栏，对齐 draw.io 样式面板的观感。
   */
  private flatSection(fill: (body: HTMLElement) => void): HTMLElement {
    const group = h("div", "drawio-fmt-flat");
    group.appendChild(h("div", "drawio-fmt-divider"));
    fill(group);
    return group;
  }

  private section(
    title: string,
    fill: (body: HTMLElement) => void,
    open = true
  ): HTMLElement {
    const sec = h("div", "drawio-fmt-section" + (open ? " open" : ""));
    const head = h("div", "drawio-fmt-section-header");
    head.appendChild(h("span", undefined, title));
    head.appendChild(h("span", "drawio-fmt-section-arrow", "▸"));
    sec.appendChild(head);
    const body = h("div", "drawio-fmt-section-body");
    fill(body);
    sec.appendChild(body);
    head.addEventListener("click", () => sec.classList.toggle("open"));
    return sec;
  }

  private colorField(
    initial: string,
    onChange: (hex: string) => void
  ): HTMLElement {
    const wrap = h("div", "drawio-fmt-color");
    wrap.style.background = initial;
    // 覆盖层的定位 / 透明 / 去边框等静态样式走 .drawio-fmt-color input（styles.css）
    const input = h("input") as HTMLInputElement;
    input.type = "color";
    input.value = initial;
    input.addEventListener("input", () => {
      wrap.style.background = input.value;
      onChange(input.value);
    });
    wrap.appendChild(input);
    (wrap as any)._input = input;
    return wrap;
  }

  private setColorBlock(block: HTMLElement, hex: string): void {
    block.style.background = hex;
    const input = (block as any)._input as HTMLInputElement | undefined;
    if (input && /^#[0-9a-fA-F]{6}$/.test(hex)) input.value = hex;
  }

  private hexOf(block: HTMLElement): string {
    return block.style.background || "#ffffff";
  }

  private selectField(
    opts: Array<{ v: string; t: string }>,
    value: string,
    onChange: (v: string) => void
  ): HTMLSelectElement {
    const sel = h("select", "drawio-fmt-select") as HTMLSelectElement;
    for (const o of opts) {
      const op = h("option", undefined, o.t) as HTMLOptionElement;
      op.value = o.v;
      sel.appendChild(op);
    }
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  private numberField(
    unit: string,
    value: string,
    onChange: (v: number) => void
  ): HTMLElement {
    const wrap = h("div", "drawio-fmt-number");
    const input = h("input") as HTMLInputElement;
    input.type = "number";
    input.value = value;
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) onChange(v);
    });
    wrap.appendChild(input);
    wrap.appendChild(h("span", "drawio-fmt-unit", unit));
    (wrap as any)._input = input;
    return wrap;
  }

  private lineStyleField(
    opts: Array<{ v: string; dash: string | null }>,
    value: string,
    onChange: (v: string) => void
  ): HTMLElement {
    const wrap = h("div", "drawio-fmt-linestyle");
    const trigger = h("div", "drawio-fmt-linestyle-trigger");

    const renderSvg = (dash: string | null) => {
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
      return `<svg viewBox="0 0 120 20" width="100%" height="20" preserveAspectRatio="none"><line x1="0" y1="10" x2="120" y2="10" stroke="currentColor" stroke-width="2"${dashAttr}/></svg>`;
    };

    const updateTrigger = (v: string) => {
      const opt = opts.find((o) => o.v === v) || opts[0];
      setSvgMarkup(trigger, renderSvg(opt.dash));
    };

    updateTrigger(value);

    const menu = h("div", "drawio-fmt-linestyle-menu");
    opts.forEach((opt) => {
      const item = h(
        "div",
        "drawio-fmt-linestyle-item" + (opt.v === value ? " active" : "")
      ) as HTMLElement;
      item.dataset.value = opt.v;
      setSvgMarkup(item, renderSvg(opt.dash));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onChange(opt.v);
        updateTrigger(opt.v);
        menu.querySelectorAll(".drawio-fmt-linestyle-item").forEach((el) =>
          el.classList.remove("active")
        );
        item.classList.add("active");
        menu.classList.remove("open");
      });
      menu.appendChild(item);
    });

    const closeMenu = (e: Event) => {
      if (!wrap.contains(e.target as Node)) {
        menu.classList.remove("open");
        document.removeEventListener("click", closeMenu);
      }
    };

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.classList.contains("open")) {
        menu.classList.remove("open");
        document.removeEventListener("click", closeMenu);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 2}px`;
      menu.style.left = `${rect.left}px`;
      menu.style.width = `${rect.width}px`;
      menu.classList.add("open");
      document.addEventListener("click", closeMenu);
    });

    (wrap as any)._setValue = (v: string) => {
      updateTrigger(v);
      menu.querySelectorAll(".drawio-fmt-linestyle-item").forEach((el) =>
        el.classList.remove("active")
      );
      const item = menu.querySelector(
        `.drawio-fmt-linestyle-item[data-value="${v}"]`
      );
      item?.classList.add("active");
    };

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return wrap;
  }

  private toggleBtn(
    text: string,
    cls: string,
    active: boolean,
    onChange: (on: boolean) => void
  ): HTMLButtonElement {
    // 字形预览走修饰类（styles.css 的 .drawio-fmt-tbtn-*），别写内联样式。
    // 「S」在改动前就没有字形预览样式，这里保持原样、不顺手补。
    const glyph =
      cls === "bold"
        ? " drawio-fmt-tbtn-bold"
        : cls === "italic"
          ? " drawio-fmt-tbtn-italic"
          : cls === "underline"
            ? " drawio-fmt-tbtn-underline"
            : "";
    const b = h(
      "button",
      `drawio-fmt-tbtn${glyph}${active ? " active" : ""}`,
      text
    ) as HTMLButtonElement;
    b.addEventListener("click", () => {
      b.classList.toggle("active");
      onChange(b.classList.contains("active"));
    });
    return b;
  }

  private iconToggleBtn(
    key: string,
    d: string,
    active: boolean,
    onClick: () => void
  ): HTMLButtonElement {
    const b = h(
      "button",
      "drawio-fmt-tbtn icon" + (active ? " active" : "")
    ) as HTMLButtonElement;
    setSvgMarkup(
      b,
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
    );
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------- 样式写入 ----------

  private applyStyle(key: string, value: any): void {
    if (!this.graph || this.currentCells.length === 0) return;
    const cells = this.currentCells;
    this.graph.getModel().beginUpdate();
    try {
      this.graph.setCellStyles(key, value, cells);
    } finally {
      this.graph.getModel().endUpdate();
    }
    this.onChange();
  }

  private applyGeometry(mut: (geo: any) => void): void {
    if (!this.graph || this.currentCells.length === 0) return;
    const model = this.graph.getModel();
    model.beginUpdate();
    try {
      for (const cell of this.currentCells) {
        let geo = model.getGeometry(cell);
        if (!geo) continue;
        geo = geo.clone();
        mut(geo);
        model.setGeometry(cell, geo);
      }
    } finally {
      model.endUpdate();
    }
    this.onChange();
  }

  private setFontStyle(flag: number, on: boolean): void {
    const cur = this.MxUtils.getNumber(
      this.currentStyle,
      this.MxConstants.STYLE_FONTSTYLE,
      0
    );
    const v = on ? cur | flag : cur & ~flag;
    this.applyStyle(this.MxConstants.STYLE_FONTSTYLE, v === 0 ? null : String(v));
  }

  private applyAlign(align: string): void {
    if (!this.graph || this.currentCells.length === 0) return;
    this.graph.alignCells(align, this.currentCells);
    this.onChange();
  }

  private toggleFlip(key: string): void {
    const cur = this.MxUtils.getValue(this.currentStyle, key, "0");
    this.applyStyle(key, cur === "1" ? null : "1");
    this.refresh(this.currentCells);
  }

  private copyStyle(): void {
    if (this.currentCells.length === 0) return;
    const style = this.graph.getCellStyle(this.currentCells[0]);
    try {
      void navigator.clipboard?.writeText(JSON.stringify(style));
    } catch {
      /* ignore */
    }
    this.onChange();
  }

  private setAsDefaultStyle(): void {
    if (this.currentCells.length === 0) return;
    const style = this.graph.getCellStyle(this.currentCells[0]);
    const sheet = this.graph.getStylesheet();
    sheet.putDefaultVertexStyle(Object.assign({}, style));
    this.onChange();
  }

  // ---------- 显示 / 刷新 ----------

  show(cells: any[]): void {
    this.currentCells = cells || [];
    this.root.classList.remove("drawio-collapsed");
    this.refresh(cells);
  }

  hide(): void {
    this.root.classList.add("drawio-collapsed");
  }

  private refresh(cells: any[]): void {
    if (!cells || cells.length === 0) return;
    this.currentCells = cells;
    const cell = cells[0];
    this.currentStyle = this.graph.getCellStyle(cell);

    const get = (key: string, def?: any) =>
      this.MxUtils.getValue(this.currentStyle, key, def);

    // 样式 Tab
    const fill = get(this.MxConstants.STYLE_FILLCOLOR, "none");
    this.fillCheck.checked = fill !== "none" && fill != null;
    this.setColorBlock(this.fillColor, this.toHex(fill));
    const gradient = get(this.MxConstants.STYLE_GRADIENTCOLOR, "none");
    const hasGradient = gradient !== "none" && gradient != null;
    this.gradientCheck.checked = hasGradient;
    this.gradientDirection.disabled = !hasGradient;
    (this.gradientColor as any)._input.disabled = !hasGradient;
    this.gradientDirection.value = get(
      this.MxConstants.STYLE_GRADIENT_DIRECTION,
      this.MxConstants.DIRECTION_SOUTH
    );
    this.setColorBlock(this.gradientColor, this.toHex(gradient));
    const stroke = get(this.MxConstants.STYLE_STROKECOLOR, "none");
    this.strokeCheck.checked = stroke !== "none" && stroke != null;
    this.setColorBlock(this.strokeColor, this.toHex(stroke));
    this.syncStylePalette(fill, stroke, gradient);
    const dashed = get(this.MxConstants.STYLE_DASHED, null);
    const dashPattern = get(this.MxConstants.STYLE_DASH_PATTERN, null);
    let lineValue = "solid";
    if (dashed === "1") {
      if (dashPattern === "1 3") lineValue = "dotted";
      else if (dashPattern === "6 2 1 2") lineValue = "dashDot";
      else if (dashPattern === "6 2 1 2 1 2") lineValue = "dashDotDot";
      else lineValue = "dashed";
    }
    (this.lineType as any)._setValue?.(lineValue);
    const sw = get(this.MxConstants.STYLE_STROKEWIDTH, "1");
    this.setNumber(this.strokeWidth, sw);
    const op = get(this.MxConstants.STYLE_OPACITY, "100");
    this.setNumber(this.styleOpacity, op);
    this.roundedCheck.checked =
      get(this.MxConstants.STYLE_ROUNDED, null) === "1";
    this.sketchCheck.checked = get("sketch", null) === "1";
    this.glassCheck.checked = get(this.MxConstants.STYLE_GLASS, null) === "1";
    this.shadowCheck.checked =
      get(this.MxConstants.STYLE_SHADOW, null) === "1";

    // 文本 Tab
    const ff = get(this.MxConstants.STYLE_FONTFAMILY, "Helvetica");
    this.fontFamily.value = FONT_FAMILIES.includes(ff) ? ff : "Helvetica";
    const fs = String(get(this.MxConstants.STYLE_FONTSIZE, "12"));
    this.fontSize.value = FONT_SIZES.map(String).includes(fs) ? fs : "12";
    const fs2 = get(this.MxConstants.STYLE_FONTSTYLE, 0);
    this.boldBtn.classList.toggle("active", (Number(fs2) & this.MxConstants.FONT_BOLD) !== 0);
    this.italicBtn.classList.toggle("active", (Number(fs2) & this.MxConstants.FONT_ITALIC) !== 0);
    this.underlineBtn.classList.toggle("active", (Number(fs2) & this.MxConstants.FONT_UNDERLINE) !== 0);
    this.strikeBtn.classList.toggle("active", (Number(fs2) & this.MxConstants.FONT_STRIKETHROUGH) !== 0);
    const align = get(this.MxConstants.STYLE_ALIGN, this.MxConstants.ALIGN_CENTER);
    Object.entries(this.alignBtns).forEach(([k, b]) =>
      b.classList.toggle("active", k === align)
    );
    const valign = get(this.MxConstants.STYLE_VERTICAL_ALIGN, this.MxConstants.ALIGN_MIDDLE);
    Object.entries(this.valignBtns).forEach(([k, b]) =>
      b.classList.toggle("active", k === valign)
    );
    const horiz = get(this.MxConstants.STYLE_HORIZONTAL, null);
    this.writingDir.value = horiz === "0" ? "v" : "auto";
    this.setColorBlock(this.fontColor, this.toHex(get(this.MxConstants.STYLE_FONTCOLOR, "#000000")));
    this.setColorBlock(this.textBgColor, this.toHex(get(this.MxConstants.STYLE_LABEL_BACKGROUNDCOLOR, "none")));
    this.setColorBlock(this.textBorderColor, this.toHex(get(this.MxConstants.STYLE_LABEL_BORDERCOLOR, "none")));
    this.wrapCheck.checked = get(this.MxConstants.STYLE_WHITE_SPACE, null) === this.MxConstants.WORD_WRAP;
    this.htmlCheck.checked = get(this.MxConstants.STYLE_HTML, null) === "1";
    this.setNumber(this.textOpacity, get(this.MxConstants.STYLE_TEXT_OPACITY, "100"));

    // 排列 Tab
    const geo = this.graph.getModel().getGeometry(cell);
    if (geo) {
      this.setNumber(this.widthInput, Math.round(geo.width));
      this.setNumber(this.heightInput, Math.round(geo.height));
      this.setNumber(this.leftInput, Math.round(geo.x));
      this.setNumber(this.topInput, Math.round(geo.y));
      if (geo.width && geo.height) this.origRatio = geo.width / geo.height;
    }
    const rot = get(this.MxConstants.STYLE_ROTATION, "0");
    this.setNumber(this.rotationInput, rot);
    const locked = get(this.MxConstants.STYLE_LOCKED, "0") === "1";
    this.lockBtn.textContent = locked ? t("format.unlock") : t("format.lock");
    const isGroup = cells.length === 1 && this.graph.getModel().getChildCount(cell) > 0;
    this.groupBtn.disabled = cells.length < 2 && !isGroup;
  }

  private toHex(c: string | undefined): string {
    if (!c || c === "none" || c === "transparent") return "#ffffff";
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
      return (
        "#" +
        c
          .slice(1)
          .split("")
          .map((ch) => ch + ch)
          .join("")
      );
    }
    return "#ffffff";
  }

  private setNumber(wrap: HTMLElement, value: any): void {
    const input = (wrap as any)._input as HTMLInputElement | undefined;
    if (input) input.value = String(value);
  }
}
