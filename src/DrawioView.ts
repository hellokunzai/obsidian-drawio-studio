import { FileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import DrawioPlugin from "./main";
import {
  initMxGraph,
  mxGraph,
  mxUtils,
  mxCodec,
  mxEvent,
  mxConstants,
  mxRubberband,
  mxRectangle,
  mxKeyHandler,
  mxUndoManager,
  mxImage,
  mxConnectionConstraint,
  mxPoint,
} from "./mxgraph-setup";
import { getAllShapeCategories, getShapeLabel, ShapeDef } from "./shapes";
import { loadAllStencils } from "./stencil-loader";
import {
  ScratchShape,
  DrawioSettings,
  LayerDef,
  PanelGeometry,
  MIN_PALETTE_WIDTH,
  MAX_PALETTE_WIDTH,
} from "./settings";
import { TextEditModal } from "./TextEditModal";
import { setCssVars, clearCssVars } from "./cssVars";
import { inflate } from "pako";
import { t, tOr } from "./i18n";
import { FormatPanel } from "./FormatPanel";
import { DrawPanel, mmToPageUnits } from "./DrawPanel";
import { PageBar } from "./PageBar";
import {
  ViewFeatureKey,
  ViewMenu,
  ViewMenuItem,
} from "./ViewMenu";
import { Ruler } from "./Ruler";
import { FloatingPanelHost } from "./FloatingPanel";
import { FindReplacePanel } from "./FindReplacePanel";
import { DEFAULT_LAYER_ID, LayersPanel } from "./LayersPanel";
import { TagsPanel } from "./TagsPanel";
import { MinimapPanel } from "./MinimapPanel";
import { setSvgMarkup } from "./svg";

export const VIEW_TYPE_DRAWIO = "drawio-studio-view";
/** 自绘流程图图标 id，在 main.ts 的 onload 里通过 addIcon 注册 */
export const DRAWIO_ICON_ID = "drawio-diagram";

/**
 * 把 mxGraph 的 value 归一成字符串。
 *
 * value 可能是纯字符串，也可能是 XML 节点（label 里带 HTML 时 mxGraph 存节点）。
 * 节点走 XMLSerializer（mxUtils.getXml）而不是 `outerHTML`：后者属于官方点名的
 * 属性，而且在 XML 文档上语义不如 XMLSerializer 明确。
 */
function valueToText(value: any): string {
  if (typeof value === "string") return value;
  if (value && typeof value.nodeType === "number") {
    try {
      return mxUtils().getXml(value) || String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * 一个页面：对应 `.drawio` 文件里 `<mxfile>` 下的一个 `<diagram>` 节点。
 * `xml` 保存该页的 `<mxGraphModel>` 序列化文本（未压缩），
 * 非活动页的模型就静静躺在这里，切换时再解码回画布。
 */
interface DiagramPage {
  id: string;
  name: string;
  xml: string;
}

/** 浮动工具窗的最小接口：这里只关心开合 */
interface ToolPanelLike {
  isOpen(): boolean;
  open(): void;
  close(): void;
}

/** 工具栏图标定义：filled 走实心填充，否则按线性描边渲染 */
interface IconDef {
  svg: string;
  filled?: boolean;
  /** 默认 "0 0 24 24"；字形很扁的图标给紧贴字形的 viewBox，才不会被缩成细线 */
  viewBox?: string;
}

export class DrawioView extends FileView {
  plugin: DrawioPlugin;
  private graph: any = null;
  private undoManager: any = null;
  private paletteEl: HTMLElement | null = null;
  private graphContainer: HTMLElement | null = null;
  /** 画布滚动视口：页面视图下画布块在其内部居中并留白 */
  private canvasScrollEl: HTMLElement | null = null;
  /** 上一次的「纸型 + 朝向」，用于判断是否需要把视口滚回纸面左上角 */
  private lastPagesCfg = "";
  private isDirty = false;
  private saveTimeout: number | null = null;
  private dragGhost: HTMLElement | null = null;
  private paletteDrag: {
    shape: ShapeDef;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null = null;
  private paletteDragMove: ((e: PointerEvent) => void) | null = null;
  private paletteDragUp: ((e: PointerEvent) => void) | null = null;
  private paletteDragCancel: (() => void) | null = null;
  private suppressPaletteClick = false;
  private formatPanelEl: HTMLElement | null = null;
  private formatPanel: FormatPanel | null = null;
  /** 新增的「绘图」面板（无选中图形时显示，与原格式面板互斥） */
  private diagramPanelEl: HTMLElement | null = null;
  private drawPanel: DrawPanel | null = null;

  /** 右键上下文菜单元素（挂在 document.body，position: fixed） */
  private ctxMenuEl: HTMLElement | null = null;
  /** 右键菜单当前作用的目标单元格（右键时已确保其为选中状态） */
  private ctxTargetCell: any = null;
  /** 菜单外的点击 / 滚动 / Esc 关闭监听 */
  private ctxOutsidePointer: ((e: PointerEvent) => void) | null = null;
  private ctxOutsideKey: ((e: KeyboardEvent) => void) | null = null;
  private ctxOutsideWheel: ((e: Event) => void) | null = null;
  /** 内部剪贴板：剪切 / 复制暂存的克隆单元格 */
  private clipboardCells: any[] | null = null;
  /** 连续粘贴的层数，用于逐次递增偏移，避免多次粘贴完全重叠 */
  private clipboardPasteCount = 0;
  /** 便签本分组在形状面板中的引用，便于新增后原地刷新 */
  private scratchSectionEl: HTMLElement | null = null;
  private scratchGridEl: HTMLElement | null = null;

  /** 多页：页列表 + 当前活动页下标（对齐 draw.io 一个文件多页） */
  private pages: DiagramPage[] = [];
  private activePage = 0;
  /** 底部页面栏 */
  private pageBar: PageBar | null = null;
  /** 切页时要重装整个模型，期间屏蔽脏标记 / 自动保存 */
  private suppressDirty = false;
  /**
   * 文件解析失败时置位：此时画布是空的，如果放任自动保存写盘
   * 会把用户原本的文件内容覆盖掉。故只挡住自动保存，手动保存仍由用户决定。
   */
  private loadError = false;

  // ---- 视图菜单（工具栏最左侧按钮）及其功能面板 ----
  /** 画布区容器：标尺与浮动工具窗都挂在这里（position: relative） */
  private canvasAreaEl: HTMLElement | null = null;
  /** 形状面板与它的拖拽把手，供「形状」开关整块隐藏 */
  private paletteResizeEl: HTMLElement | null = null;
  /** 右侧面板轨道，供「格式」开关整块隐藏 */
  private railEl: HTMLElement | null = null;
  private viewBtnEl: HTMLElement | null = null;
  /** 工具栏撤销 / 重做按钮，用于按历史栈可用性切换置灰态 */
  private undoBtnEl: HTMLButtonElement | null = null;
  private redoBtnEl: HTMLButtonElement | null = null;
  private viewMenu: ViewMenu | null = null;
  private ruler: Ruler | null = null;
  private findPanel: FindReplacePanel | null = null;
  private layersPanel: LayersPanel | null = null;
  private tagsPanel: TagsPanel | null = null;
  private minimapPanel: MinimapPanel | null = null;
  /** 当前图层 id（新建图形归入该层）；空串 = 默认图层 */
  private currentLayerId: string = DEFAULT_LAYER_ID;

  constructor(leaf: WorkspaceLeaf, plugin: DrawioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_DRAWIO;
  }

  getDisplayText(): string {
    return this.file?.basename ?? t("view.displayText");
  }

  getIcon(): string {
    return DRAWIO_ICON_ID;
  }

  async onLoadFile(file: TFile): Promise<void> {
    initMxGraph();
    loadAllStencils();
    this.buildUI();
    this.initGraphEditor();
    await this.loadDiagram(file);
  }

  async onUnloadFile(): Promise<void> {
    this.cleanup();
  }

  async onClose(): Promise<void> {
    this.cleanup();
  }

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("drawio-studio-container");

    // 顶部工具栏：横跨整个视图宽度（对齐 draw.io 顶部菜单栏的位置）。
    // 之前它挂在画布区里，导致形状面板和它挤在同一行、把顶部那一条挡住，
    // 现在把工具栏提到最上面独占一行，形状面板从它下方开始。
    this.buildToolbar(container);

    const wrapper = container.createDiv({ cls: "drawio-wrapper" });

    // Palette sidebar（宽度读取设置，可用右缘把手拖拽调整）
    this.paletteEl = wrapper.createDiv({ cls: "drawio-palette" });
    this.paletteEl.style.width = `${this.plugin.settings.paletteWidth}px`;
    this.buildPalette(this.paletteEl);

    // 面板右缘拖拽把手
    const resizeHandle = wrapper.createDiv({ cls: "drawio-palette-resize" });
    this.paletteResizeEl = resizeHandle;
    this.makePaletteResizable(resizeHandle);

    // Main area（横向：左侧画布区 + 右侧格式面板）
    const mainArea = wrapper.createDiv({ cls: "drawio-main" });
    const canvasArea = mainArea.createDiv({ cls: "drawio-canvas-area" });
    this.canvasAreaEl = canvasArea;
    // 滚动视口：页面视图开启时画布块在其中居中，四周留白由它的 padding 提供
    this.canvasScrollEl = canvasArea.createDiv({ cls: "drawio-canvas-scroll" });
    this.graphContainer = this.canvasScrollEl.createDiv({
      cls: "drawio-graph-container",
    });

    // 底部页面栏：宽度与画布区一致（右抵格式面板），与 draw.io 行为相同
    this.buildPageBar(canvasArea);

    // 右侧面板轨道：宽度固定 300px，里面放两个互斥的面板，切换时画布宽度不跳。
    //   上/后者 = 原「格式」面板（选中图形时显示，默认折叠）
    //   前者    = 新增的「绘图」面板（无选中时显示）
    const rail = mainArea.createDiv({ cls: "drawio-panel-rail" });
    this.railEl = rail;
    this.diagramPanelEl = rail.createDiv({ cls: "drawio-diagram-panel" });
    this.formatPanelEl = rail.createDiv({
      cls: "drawio-format-panel drawio-collapsed",
    });

    // 视图菜单带来的东西：标尺（覆盖在画布区上）与四个浮动工具窗，都挂画布区
    this.setupViewFeatures();
  }

  /** 构建底部页面栏，并把页面操作回抛到视图自身 */
  private buildPageBar(parent: HTMLElement): void {
    this.pageBar = new PageBar(
      {
        getPages: () => this.pages.map((p) => ({ id: p.id, name: p.name })),
        getActiveIndex: () => this.activePage,
        selectPage: (index) => this.selectPage(index),
        addPage: () => this.addPage(),
        renamePage: (index, name) => this.renamePage(index, name),
        insertPage: (index) => this.insertPage(index),
        duplicatePage: (index) => this.duplicatePage(index),
        deletePage: (index) => this.deletePage(index),
        movePage: (from, to) => this.movePage(from, to),
      },
      parent
    );
    this.pageBar.render();
  }

  /**
   * 面板右缘拖拽调整宽度：pointer 事件自建拖拽（与项目拖拽风格一致），
   * 拖动结束时把宽度写回设置持久化；grid 用 auto-fill，列数随宽度自适应。
   */
  private makePaletteResizable(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      const palette = this.paletteEl;
      if (!palette) return;

      const startX = e.clientX;
      const startWidth = palette.getBoundingClientRect().width;
      // 拖拽中禁止页面文本选中，并把光标钉在 col-resize 上
      document.body.addClass("drawio-palette-resizing");

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const w = Math.min(
          MAX_PALETTE_WIDTH,
          Math.max(MIN_PALETTE_WIDTH, startWidth + ev.clientX - startX)
        );
        palette.style.width = `${Math.round(w)}px`;
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        document.body.removeClass("drawio-palette-resizing");
        if (this.paletteEl) {
          this.plugin.settings.paletteWidth = Math.round(
            this.paletteEl.getBoundingClientRect().width
          );
          void this.plugin.saveSettings();
        }
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  private buildPalette(parent: HTMLElement): void {
    const categories = getAllShapeCategories();

    // 搜索框：跨分组过滤形状（sticky 吸顶，不随列表滚动）
    const searchWrap = parent.createDiv({ cls: "drawio-palette-search" });
    const searchInput = searchWrap.createEl("input", {
      cls: "drawio-palette-search-input",
      attr: { type: "text", placeholder: t("palette.searchPlaceholder") },
    });

    const resetSearch = () => {
      searchInput.value = "";
      this.filterPalette("");
    };
    searchInput.addEventListener("input", () => this.filterPalette(searchInput.value));
    searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
      // 输入框里的 Escape 只清搜索，不冒泡给 Obsidian（避免误关面板）
      if (e.key === "Escape" && searchInput.value !== "") {
        e.stopPropagation();
        resetSearch();
      }
    });

    // 无匹配时的提示，filterPalette 控制显隐
    parent.createDiv({ cls: "drawio-palette-no-results drawio-hidden", text: t("palette.noResults") });

    for (const category of categories) {
      const section = parent.createDiv({ cls: "drawio-palette-section" });
      section.dataset.categoryKey = category.key;
      // 通用/杂项/高级默认折叠，便笺本默认展开（无论是否有收藏）
      if (category.defaultCollapsed) {
        section.addClass("drawio-palette-section-collapsed");
      }
      const header = section.createEl("button", { cls: "drawio-palette-header", attr: { type: "button" } });
      header.createSpan({ cls: "drawio-palette-arrow", text: "▾" });
      header.createSpan({
        cls: "drawio-palette-title",
        text: tOr(`shapeCategory.${category.key}`, category.title),
      });

      const grid = section.createDiv({ cls: "drawio-palette-grid" });

      header.addEventListener("click", () => {
        const isCollapsed = section.hasClass("drawio-palette-section-collapsed");
        if (isCollapsed) {
          section.removeClass("drawio-palette-section-collapsed");
        } else {
          section.addClass("drawio-palette-section-collapsed");
        }
      });

      // 便签本分组的网格由用户收藏动态填充
      if (category.key === "scratchpad") {
        this.scratchSectionEl = section;
        this.scratchGridEl = grid;
        continue;
      }

      for (const shape of category.shapes) {
        this.appendPaletteItem(grid, shape);
      }
    }

    // 用当前收藏填充便签本网格；空时隐藏分组
    this.fillScratchGrid();
  }

  /** 把一个静态形状项追加到指定网格 */
  private appendPaletteItem(grid: HTMLElement, shape: ShapeDef): void {
    const item = grid.createDiv({ cls: "drawio-palette-item" });
    item.setAttribute("data-shape-id", shape.id);
    item.setAttribute("title", getShapeLabel(shape));

    setSvgMarkup(
      item,
      `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${shape.icon}"/></svg>`
    );

    this.makeShapeDraggable(item, shape);

    item.addEventListener("click", () => {
      // 拖拽落点恰好在面板项上时会接着触发 click，吞掉一次避免误添加
      if (this.suppressPaletteClick) {
        this.suppressPaletteClick = false;
        return;
      }
      this.addShapeAtCenter(shape);
    });
  }

  /** 把当前 settings.scratchpad 渲染进便签本网格（清空后重建）。分组始终可见。 */
  private fillScratchGrid(): void {
    const grid = this.scratchGridEl;
    if (!grid) return;
    grid.empty();
    // 便签本分组始终显示（无论是否有收藏）；空时给出提示
    this.scratchSectionEl?.classList.remove("drawio-hidden");
    const items = this.plugin.settings.scratchpad;
    if (!items || items.length === 0) {
      grid.createDiv({ cls: "drawio-palette-scratch-empty", text: t("notice.scratchpadEmpty") });
      return;
    }

    items.forEach((def, idx) => {
      const shapeDef = this.scratchToShapeDef(def, idx);
      const item = grid.createDiv({
        cls: "drawio-palette-item drawio-palette-scratch-item",
      });
      item.setAttribute("data-shape-id", shapeDef.id);
      item.setAttribute("title", shapeDef.name);
      setSvgMarkup(
        item,
        `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${shapeDef.icon}"/></svg>`
      );

      this.makeShapeDraggable(item, shapeDef);

      item.addEventListener("click", () => {
        if (this.suppressPaletteClick) {
          this.suppressPaletteClick = false;
          return;
        }
        this.addShapeAtCenter(shapeDef);
      });

      // 悬停显示移除按钮，避免便签本无限累积
      const del = item.createEl("button", {
        cls: "drawio-palette-scratch-del",
        text: "×",
        attr: { type: "button", "aria-label": t("ctx.scratchpadRemove") },
      });
      // 按住移除按钮不应触发面板拖拽（pointerdown 会冒泡到 item 上的拖拽监听）
      del.addEventListener("pointerdown", (e) => e.stopPropagation());
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.removeFromScratchpad(idx);
      });
    });
  }

  /** 从便签本移除一项并持久化 + 刷新面板 */
  private removeFromScratchpad(index: number): void {
    const list = this.plugin.settings.scratchpad;
    if (index < 0 || index >= list.length) return;
    list.splice(index, 1);
    void this.plugin.saveSettings();
    this.rebuildScratchSection();
  }

  /** 新增 / 删除便签本后原地刷新网格（分组尚不存在时按需创建） */
  private rebuildScratchSection(): void {
    if (!this.scratchGridEl) {
      if (this.paletteEl && this.plugin.settings.scratchpad.length > 0) {
        this.ensureScratchSection(this.paletteEl);
      }
      return;
    }
    this.fillScratchGrid();
  }

  /** 当 buildPalette 未生成便签本分组时（理论上已包含）兜底创建 */
  private ensureScratchSection(parent: HTMLElement): void {
    if (this.scratchSectionEl) return;

    const section = parent.createDiv({
      cls: "drawio-palette-section drawio-palette-scratch",
    });
    section.dataset.categoryKey = "scratchpad";
    const header = section.createEl("button", {
      cls: "drawio-palette-header",
      attr: { type: "button" },
    });
    header.createSpan({ cls: "drawio-palette-arrow", text: "▾" });
    header.createSpan({
      cls: "drawio-palette-title",
      text: tOr("shapeCategory.scratchpad", "Scratchpad"),
    });
    header.addEventListener("click", () => {
      const collapsed = section.hasClass("drawio-palette-section-collapsed");
      section.toggleClass("drawio-palette-section-collapsed", !collapsed);
    });

    const grid = section.createDiv({ cls: "drawio-palette-grid" });
    this.scratchSectionEl = section;
    this.scratchGridEl = grid;
    this.fillScratchGrid();
  }

  /** 把持久化的 ScratchShape 转成拖拽 / 落点需要的 ShapeDef */
  private scratchToShapeDef(def: ScratchShape, index: number): ShapeDef {
    return {
      id: def.isEdge ? `scratch-edge-${index}` : `scratch-${index}`,
      name: def.value || t("ctx.scratchpad"),
      style: def.style,
      width: def.width,
      height: def.height,
      icon: def.icon,
    };
  }

  /**
   * 按关键字过滤形状面板：匹配 i18n 名称 / 英文名 / 形状 id（不区分大小写）。
   * 搜索时隐藏无匹配的分组，含匹配项的分组强制展开（加 filtered 类，不破坏
   * 用户原有的折叠状态）；清空后全部恢复。
   */
  private filterPalette(query: string): void {
    if (!this.paletteEl) return;
    const q = query.trim().toLowerCase();
    const categories = getAllShapeCategories();
    const sections = Array.from(
      this.paletteEl.querySelectorAll<HTMLElement>(".drawio-palette-section")
    );
    let anyMatch = false;

    sections.forEach((section) => {
      const key = section.dataset.categoryKey;
      const category = categories.find((c) => c.key === key);
      if (!category) return;
      let sectionHasMatch = false;

      if (key === "scratchpad") {
        // 便签本内容是动态持久化的收藏，单独转换后匹配
        for (const item of Array.from(
          section.querySelectorAll<HTMLElement>(".drawio-palette-item")
        )) {
          const shapeId = item.getAttribute("data-shape-id") ?? "";
          const idxMatch = shapeId.match(/^scratch(?:-edge)?-(\d+)$/);
          const idx = idxMatch ? parseInt(idxMatch[1], 10) : -1;
          const def = idx >= 0 ? this.plugin.settings.scratchpad[idx] : undefined;
          const shapeDef = def ? this.scratchToShapeDef(def, idx) : undefined;
          const hit =
            q === "" ||
            shapeId.toLowerCase().includes(q) ||
            (shapeDef !== undefined &&
              shapeDef.name.toLowerCase().includes(q));
          item.toggleClass("drawio-hidden", !hit);
          if (hit) sectionHasMatch = true;
        }
      } else {
        for (const item of Array.from(
          section.querySelectorAll<HTMLElement>(".drawio-palette-item")
        )) {
          const shapeId = item.getAttribute("data-shape-id") ?? "";
          const shape = category.shapes.find((s) => s.id === shapeId);
          const hit =
            q === "" ||
            shapeId.toLowerCase().includes(q) ||
            (shape !== undefined &&
              (getShapeLabel(shape).toLowerCase().includes(q) ||
                shape.name.toLowerCase().includes(q)));
          item.toggleClass("drawio-hidden", !hit);
          if (hit) sectionHasMatch = true;
        }
      }

      section.toggleClass("drawio-hidden", q !== "" && !sectionHasMatch);
      section.toggleClass("drawio-palette-section-filtered", q !== "" && sectionHasMatch);
      if (sectionHasMatch) anyMatch = true;
    });

    const noResults = this.paletteEl.querySelector<HTMLElement>(".drawio-palette-no-results");
    noResults?.toggleClass("drawio-hidden", q === "" || anyMatch);
  }

  /**
   * 面板图形拖拽：不用浏览器原生 HTML5 DnD——其拖拽位图在 Obsidian/Electron 里
   * 会退回为「面板项截图」（带圆角灰底），setDragImage 无法可靠覆盖。
   * 改为 pointer 事件自建拖拽：跟随光标的只有一个透明底的 SVG 轮廓，
   * 且天然兼容移动端触摸。
   */
  private makeShapeDraggable(el: HTMLElement, shape: ShapeDef): void {
    el.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.beginPaletteDrag(e, shape);
    });
  }

  private beginPaletteDrag(e: PointerEvent, shape: ShapeDef): void {
    this.endPaletteDrag(); // 清理可能残留的上一轮拖拽
    this.paletteDrag = {
      shape,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    };

    this.paletteDragMove = (ev: PointerEvent) => this.onPaletteDragMove(ev);
    this.paletteDragUp = (ev: PointerEvent) => this.onPaletteDragEnd(ev);
    this.paletteDragCancel = () => this.endPaletteDrag();

    // 注意不做 setPointerCapture：捕获后 pointerup 无论落在哪都会向源元素派生 click，
    // 会把「拖到画布」误判成「点击面板项」而在画布中心多加一个图形。
    document.addEventListener("pointermove", this.paletteDragMove);
    document.addEventListener("pointerup", this.paletteDragUp);
    document.addEventListener("pointercancel", this.paletteDragCancel);
  }

  private onPaletteDragMove(e: PointerEvent): void {
    const drag = this.paletteDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;

    if (!drag.dragging) {
      // 超过阈值才算拖拽，否则留给 click（点击 = 添加到画布中心）
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DrawioView.DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      this.createDragGhost(drag.shape);
    }
    this.positionDragGhost(e.clientX, e.clientY);
  }

  private onPaletteDragEnd(e: PointerEvent): void {
    const drag = this.paletteDrag;
    this.endPaletteDrag();
    if (!drag || !drag.dragging) return; // 未构成拖拽，按点击处理

    this.suppressPaletteClick = true;

    if (!this.graph || !this.graphContainer) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || !this.graphContainer.contains(target)) return;

    // getPointForEvent 读取 clientX/clientY 并已做网格吸附，PointerEvent 同样适用
    const pt = this.graph.getPointForEvent(e);
    // 以鼠标为中心落点，与 draw.io 行为一致
    this.addShape(drag.shape, pt.x - drag.shape.width / 2, pt.y - drag.shape.height / 2);
  }

  private endPaletteDrag(): void {
    if (this.paletteDragMove) {
      document.removeEventListener("pointermove", this.paletteDragMove);
      this.paletteDragMove = null;
    }
    if (this.paletteDragUp) {
      document.removeEventListener("pointerup", this.paletteDragUp);
      this.paletteDragUp = null;
    }
    if (this.paletteDragCancel) {
      document.removeEventListener("pointercancel", this.paletteDragCancel);
      this.paletteDragCancel = null;
    }
    this.paletteDrag = null;
    this.removeDragGhost();
  }

  /**
   * 拖拽跟随层：只含图形轮廓的 SVG，容器透明、pointer-events:none，
   * 用 transform 跟随光标，光标压在图形正中心。
   */
  private createDragGhost(shape: ShapeDef): void {
    this.removeDragGhost();

    const size = DrawioView.DRAG_GHOST_SIZE;
    const ghost = document.body.createDiv({ cls: "drawio-drag-ghost" });
    setSvgMarkup(
      ghost,
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${shape.icon}"/></svg>`
    );

    this.dragGhost = ghost;
  }

  private positionDragGhost(clientX: number, clientY: number): void {
    if (!this.dragGhost) return;
    const half = DrawioView.DRAG_GHOST_SIZE / 2;
    this.dragGhost.style.transform = `translate(${clientX - half}px, ${clientY - half}px)`;
  }

  private removeDragGhost(): void {
    this.dragGhost?.remove();
    this.dragGhost = null;
  }

  private addShape(shape: ShapeDef, x: number, y: number): void {
    const parent = this.graph.getDefaultParent();
    const isEdge = shape.id.startsWith("edge-");
    /** 本次新建的顶层 cell，稍后统一打上「当前图层」标记 */
    const created: any[] = [];

    if (isEdge) {
      this.graph.getModel().beginUpdate();
      try {
        const e1 = this.graph.insertVertex(parent, null, t("shape.edgeSource"), x, y, 60, 30, "rounded=1;whiteSpace=wrap;html=1;");
        const e2 = this.graph.insertVertex(parent, null, t("shape.edgeTarget"), x + 120, y + 80, 60, 30, "rounded=1;whiteSpace=wrap;html=1;");
        this.graph.insertEdge(parent, null, "", e1, e2, shape.style);
        created.push(e1, e2);
      } finally {
        this.graph.getModel().endUpdate();
      }
    } else {
      this.graph.getModel().beginUpdate();
      try {
        created.push(
          this.graph.insertVertex(parent, null, getShapeLabel(shape), x, y, shape.width, shape.height, shape.style)
        );
      } finally {
        this.graph.getModel().endUpdate();
      }
    }

    // 新图形归入当前图层；该层若处于隐藏 / 锁定状态，新图形也要跟着
    if (this.currentLayerId && this.layersPanel) {
      this.layersPanel.assignLayer(created, this.currentLayerId);
      this.layersPanel.applyLayerState(this.currentLayerId);
    }

    this.markDirty();
  }

  private addShapeAtCenter(shape: ShapeDef): void {
    if (!this.graph) return;
    const scale = this.graph.view.scale;
    const rect = this.graphContainer!.getBoundingClientRect();
    const cx = rect.width / 2 / scale - this.graph.view.translate.x;
    const cy = rect.height / 2 / scale - this.graph.view.translate.y;
    this.addShape(shape, cx - shape.width / 2, cy - shape.height / 2);
  }

  private buildToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "drawio-toolbar" });

    // ★ 最左侧：视图菜单按钮（图标 + 下拉箭头），对齐 draw.io 顶部工具栏的第一个按钮
    // clickable-icon：Obsidian 自己的图标按钮类，能让主题的
    // `button:not(.clickable-icon)` 规则不匹配，避免被画成「灰底实心按钮」
    this.viewBtnEl = toolbar.createEl("button", {
      cls: "clickable-icon drawio-toolbar-btn drawio-toolbar-viewbtn",
      attr: { title: t("view.menu"), "aria-label": t("view.menu") },
    });
    setSvgMarkup(
      this.viewBtnEl,
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' +
        '<rect x="3" y="4.5" width="15" height="15" rx="1.5"/><path d="M9.5 4.5v15"/></svg>' +
        '<svg class="drawio-toolbar-viewbtn-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="m6 9 6 6 6-6"/></svg>'
    );
    toolbar.createDiv({ cls: "drawio-toolbar-sep" });

    interface ToolBtn {
      id?: string;
      icon?: string;
      title?: string;
      action?: () => void;
      sep?: boolean;
    }

    const btns: ToolBtn[] = [
      { id: "undo", icon: "undo", title: t("toolbar.undo"), action: () => this.undo() },
      { id: "redo", icon: "redo", title: t("toolbar.redo"), action: () => this.redo() },
      { sep: true },
      { id: "zoomIn", icon: "zoom-in", title: t("toolbar.zoomIn"), action: () => this.graph?.zoomIn() },
      { id: "zoomOut", icon: "zoom-out", title: t("toolbar.zoomOut"), action: () => this.graph?.zoomOut() },
      { id: "fit", icon: "maximize", title: t("toolbar.fit"), action: () => this.graph?.fit() },
      { id: "reset", icon: "minimize", title: t("toolbar.resetZoom"), action: () => this.graph?.zoomActual() },
      { sep: true },
      { id: "delete", icon: "trash", title: t("toolbar.delete"), action: () => this.deleteSelected() },
      { id: "clear", icon: "file-minus", title: t("toolbar.clear"), action: () => this.clearCanvas() },
      { sep: true },
      { id: "export", icon: "download", title: t("toolbar.export"), action: () => this.exportSVG() },
      { id: "save", icon: "save", title: t("toolbar.save"), action: () => void this.saveDiagram() },
    ];

    for (const btn of btns) {
      if (btn.sep) {
        toolbar.createDiv({ cls: "drawio-toolbar-sep" });
        continue;
      }
      const el = toolbar.createEl("button", {
        cls: "clickable-icon drawio-toolbar-btn",
        attr: { title: btn.title || "" },
      });
      setSvgMarkup(el, this.renderIcon(btn.icon || ""));
      if (btn.id === "undo") this.undoBtnEl = el;
      if (btn.id === "redo") this.redoBtnEl = el;
      el.addEventListener("click", (e) => {
        e.preventDefault();
        btn.action?.();
      });
    }
    this.refreshUndoRedoState();
  }

  /**
   * 撤销 / 重做的可用态：没有可撤销（重做）的历史时置灰。
   * 与参考样式一致（灰掉的 redo），也避免点了没反应的错觉。
   */
  private refreshUndoRedoState(): void {
    const mgr = this.undoManager;
    const can = (fn: "canUndo" | "canRedo"): boolean =>
      !mgr || typeof mgr[fn] !== "function" ? true : !!mgr[fn]();
    if (this.undoBtnEl) this.undoBtnEl.disabled = !can("canUndo");
    if (this.redoBtnEl) this.redoBtnEl.disabled = !can("canRedo");
  }

  /** 渲染工具栏图标：filled 图标走实心填充，其余按线性描边 */
  private renderIcon(icon: string): string {
    const def = this.getIconDef(icon);
    if (!def.svg) return "";
    const viewBox = def.viewBox ?? "0 0 24 24";
    const paint = def.filled
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    // 尺寸交给 CSS（.drawio-toolbar .drawio-toolbar-btn > svg），别再写死在这里，
    // 否则两处尺寸不一致时 CSS 会静默赢，排查起来白费功夫。
    return `<svg viewBox="${viewBox}" ${paint}>${def.svg}</svg>`;
  }

  private getIconDef(icon: string): IconDef {
    // 撤销 / 重做用实心弯箭头（经典撤销图标），线条图标表达不出「回退」的方向感。
    // 字形本身很扁（约 2.2:1），viewBox 紧贴字形，这样在方画布里也不会被缩成一条细线。
    const filled: Record<string, IconDef> = {
      undo: {
        filled: true,
        viewBox: "1.9 6.9 20.7 9.2",
        svg: '<path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>',
      },
      redo: {
        filled: true,
        viewBox: "1.4 6.9 20.8 9.2",
        svg: '<path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>',
      },
    };
    if (filled[icon]) return filled[icon];

    const stroke: Record<string, string> = {
      "zoom-in": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
      "zoom-out": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
      maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
      minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
      trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
      "file-minus": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M9 13h6"/>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
      save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    };
    return { svg: stroke[icon] || "" };
  }

  private initGraphEditor(): void {
    if (!this.graphContainer) return;

    const MxGraph = mxGraph();
    const MxEvent = mxEvent();
    const MxUndoManager = mxUndoManager();

    this.graph = new MxGraph(this.graphContainer);

    // Editing features
    this.graph.setCellsEditable(true);
    this.graph.setConnectable(true);
    this.graph.setCellsMovable(true);
    this.graph.setCellsResizable(true);
    this.graph.setCellsSelectable(true);
    this.graph.setDropEnabled(true);
    this.graph.setMultigraph(true);
    this.graph.setAllowDanglingEdges(false);
    this.graph.setDisconnectOnMove(false);
    this.graph.setHtmlLabels(true);

    // Hover connect arrows: four direction handles on each vertex
    this.setupHoverConnectArrows();

    // Rubber-band selection
    this.setupRubberbandSelection();

    // Keyboard handler
    const KeyHandler = mxKeyHandler();
    new KeyHandler(this.graph);

    // Undo manager
    this.undoManager = new MxUndoManager();
    const undoListener = (sender: any, evt: any) => {
      this.undoManager.undoableEditHappened(evt.getProperty("edit"));
      this.markDirty();
      // 历史栈变了，撤销 / 重做的可用态跟着变
      this.refreshUndoRedoState();
    };
    this.graph.getModel().addListener(MxEvent.NOTIFY, undoListener);
    this.graph.getView().addListener(MxEvent.UNDO, undoListener);

    // Auto-save tracking（顺带刷新依赖模型内容的工具窗）
    this.graph.getModel().addListener(MxEvent.CHANGE, () => {
      this.markDirty();
      this.minimapPanel?.scheduleRender();
      this.tagsPanel?.refresh();
      this.layersPanel?.refresh();
      this.findPanel?.refresh();
    });

    // 自定义网格层需要跟随缩放 / 平移重算偏移；标尺与缩略图同理
    const view = this.graph.getView();
    const syncView = () => {
      // 页面视图下画布块尺寸 = 页面尺寸 × 缩放，缩放变了块也要跟着变
      if (this.plugin.settings.pageView) this.applyPageViewLayout();
      this.updateGridBackground();
      this.ruler?.update(this.graph);
      this.minimapPanel?.scheduleRender();
    };
    for (const evtName of [
      MxEvent.SCALE,
      MxEvent.SCALE_AND_TRANSLATE,
      MxEvent.TRANSLATE,
      MxEvent.RESET,
    ]) {
      if (evtName) view.addListener(evtName, syncView);
    }

    // 面板到画布的拖放由 pointer 事件自建拖拽处理（见 makeShapeDraggable），
    // 不再使用原生 dragover/drop。

    this.graph.popupMenuHandler.autoExpand = true;
    this.graph.zoomActual();
    this.setupCanvasNavigation();
    this.applyTheme();
    this.applySettings();
    this.setupFormatPanel();
    this.setupContextMenu();
    this.setupCanvasShortcuts();
    this.attachViewFeatures();
    this.applyViewSettings();
    // 撤销管理器此时才建好：初始历史栈为空 → 两个按钮置灰
    this.refreshUndoRedoState();
  }

  /**
   * 画布键盘快捷键（对齐 draw.io）：Ctrl+C 复制、Ctrl+X 剪切、Ctrl+V 粘贴、
   * Ctrl+D 创建副本、Del/Backspace 删除。
   * 仅在鼠标悬停于画布、且没有在编辑图形文本 / 输入框内时接管，
   * 避免抢掉 Obsidian 其他面板的复制粘贴与删除。
   *
   * 注意 mxClient 里的 mxKeyHandler 构造函数默认不绑定任何按键，
   * 所以删除键必须在这里自己接。
   */
  private setupCanvasShortcuts(): void {
    if (!this.graph || !this.graphContainer) return;
    const graph: any = this.graph;
    const container = this.graphContainer;

    /** 是否应当由画布接管这次按键（悬停中、非文本编辑态） */
    const shouldHandle = (e: KeyboardEvent): boolean => {
      if (!container.matches(":hover")) return false;
      // 正在编辑图形文本时，交给系统处理
      if (typeof graph.isEditing === "function" && graph.isEditing()) return false;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return false;
      }
      return true;
    };

    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      // 删除键（无修饰键）
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        if (!shouldHandle(e)) return;
        const cells = graph.getSelectionCells() || [];
        if (cells.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelected();
        return;
      }

      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v" && key !== "d") return;
      if (!shouldHandle(e)) return;

      const cells = graph.getSelectionCells() || [];

      if (key === "c") {
        if (cells.length === 0) return;
        this.copyCells(cells);
      } else if (key === "x") {
        if (cells.length === 0) return;
        this.copyCells(cells);
        graph.removeCells(cells);
        this.markDirty();
      } else if (key === "v") {
        if (!this.clipboardCells || this.clipboardCells.length === 0) return;
        this.pasteCells();
        this.markDirty();
      } else {
        if (cells.length === 0) return;
        this.duplicateCells(cells);
        this.markDirty();
      }
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /**
   * 右侧两个面板（同一轨道内互斥）：
   *  - 选中图形 → 原「格式」面板（样式 / 文本 / 排列）
   *  - 未选中   → 新增的「绘图」面板（绘图 / 样式）
   * 由 mxGraph 选择变化驱动切换；面板内的改动通过回调 markDirty 触发自动保存。
   */
  private setupFormatPanel(): void {
    if (!this.graph || !this.formatPanelEl || !this.diagramPanelEl) return;

    const MxEvent = mxEvent();
    this.formatPanel = new FormatPanel(this.formatPanelEl, this.graph, () =>
      this.markDirty()
    );

    this.drawPanel = new DrawPanel(this.diagramPanelEl, {
      getSettings: () => this.plugin.settings,
      patchSettings: (patch) => this.patchDiagramSettings(patch),
      editPageData: () => this.editPageData(),
      clearDefaultStyle: () => this.clearDefaultStyle(),
      applyStyleToPage: (key, value) => this.applyStyleToPage(key, value),
      getPageStyle: (key) => this.getPageStyle(key),
    });

    const selectionModel = this.graph.getSelectionModel();
    selectionModel.addListener(MxEvent.CHANGE, () => {
      const cells = this.graph.getSelectionCells();
      const hasSelection = !!(cells && cells.length > 0);
      if (hasSelection) {
        this.formatPanel?.show(cells);
      } else {
        this.formatPanel?.hide();
      }
      // 两个面板互斥：选中图形时收起绘图面板，反之收起格式面板（其 hide 内已加类）
      this.diagramPanelEl?.classList.toggle("drawio-collapsed", hasSelection);
      // 标签面板展示的是「选中图形的标签」，选择变化要跟着刷新
      this.tagsPanel?.refresh();
    });

    // 初始：无选中 → 显示绘图面板
    this.diagramPanelEl.classList.remove("drawio-collapsed");
  }

  /** 合并「绘图」面板的设置补丁：写回 settings、持久化并立即生效 */
  private patchDiagramSettings(patch: Partial<DrawioSettings>): void {
    Object.assign(this.plugin.settings, patch);
    void this.plugin.saveSettings();
    this.applyDiagramSettings();
  }

  // ============================================================ 视图菜单
  // 工具栏最左侧「视图」按钮：形状 / 格式 / 标尺 / 查找替换 / 图层 / 标签 / 缩略图

  /** 视图菜单项 ↔ 设置字段的映射 */
  private static readonly VIEW_FEATURE_FIELDS: Record<
    ViewFeatureKey,
    keyof DrawioSettings
  > = {
    shapesPalette: "viewShapesPalette",
    panelRail: "viewPanelRail",
    ruler: "viewRuler",
    find: "viewFind",
    layers: "viewLayers",
    tags: "viewTags",
    minimap: "viewMinimap",
  };

  /**
   * 创建标尺、四个浮动工具窗与视图菜单本身。
   * 此时 mxGraph 还没建好，所以面板只搭 DOM，graph 由 attachViewFeatures() 注入。
   */
  private setupViewFeatures(): void {
    const area = this.canvasAreaEl;
    if (!area) return;

    // 标尺：开关会改变画布容器尺寸，必须回头通知 mxGraph 重算
    this.ruler = new Ruler(area, () => this.resizeGraphToContainer());

    const host: FloatingPanelHost = {
      getGeometry: (id) => this.plugin.settings.panelGeometry[id],
      setGeometry: (id, geo) => this.patchPanelGeometry(id, geo),
    };

    this.findPanel = new FindReplacePanel(
      area,
      { ...host, markDirty: () => this.markDirty() },
      () => this.toggleViewFeature("find")
    );

    this.layersPanel = new LayersPanel(
      area,
      {
        ...host,
        markDirty: () => this.markDirty(),
        getLayers: () => this.plugin.settings.layers,
        saveLayers: (layers) => this.saveLayers(layers),
        getCurrentLayerId: () => this.currentLayerId,
        setCurrentLayerId: (id) => {
          this.currentLayerId = id;
        },
      },
      () => this.toggleViewFeature("layers")
    );

    this.tagsPanel = new TagsPanel(
      area,
      { ...host, markDirty: () => this.markDirty() },
      () => this.toggleViewFeature("tags")
    );

    this.minimapPanel = new MinimapPanel(area, { ...host }, () =>
      this.toggleViewFeature("minimap")
    );

    if (this.viewBtnEl) {
      this.viewMenu = new ViewMenu(this.viewBtnEl, () =>
        this.buildViewMenuItems()
      );
    }
  }

  /** 菜单每次展开 / 勾选变化时按当前设置重建（勾选状态即设置值） */
  private buildViewMenuItems(): ViewMenuItem[] {
    const s = this.plugin.settings;
    const make = (
      key: ViewFeatureKey,
      label: string,
      checked: boolean,
      separatorBefore = false
    ): ViewMenuItem => ({
      key,
      label,
      checked,
      separatorBefore,
      onToggle: () => this.toggleViewFeature(key),
    });

    return [
      make("shapesPalette", t("view.shapesPalette"), s.viewShapesPalette),
      make("panelRail", t("view.panelRail"), s.viewPanelRail),
      make("ruler", t("view.ruler"), s.viewRuler),
      make("find", t("view.find"), s.viewFind, true),
      make("layers", t("view.layers"), s.viewLayers),
      make("tags", t("view.tags"), s.viewTags),
      make("minimap", t("view.minimap"), s.viewMinimap),
    ];
  }

  /** 勾选 / 取消一个视图功能项：翻转设置、持久化并立刻生效 */
  private toggleViewFeature(key: ViewFeatureKey): void {
    const field = DrawioView.VIEW_FEATURE_FIELDS[key];
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[field as string] = !settings[field as string];
    void this.plugin.saveSettings();
    this.applyViewSettings();
  }

  /** 把视图开关落到 DOM 与面板上（幂等，可反复调用） */
  applyViewSettings(): void {
    const s = this.plugin.settings;

    // 形状面板与它的把手整块隐藏（display:none，画布自动吃掉这块宽度）
    this.paletteEl?.toggleClass("drawio-hidden", !s.viewShapesPalette);
    this.paletteResizeEl?.toggleClass("drawio-hidden", !s.viewShapesPalette);
    // 右侧面板轨道整块隐藏
    this.railEl?.toggleClass("drawio-hidden", !s.viewPanelRail);

    this.ruler?.setVisible(!!s.viewRuler);

    this.syncToolPanel(this.findPanel, s.viewFind);
    this.syncToolPanel(this.layersPanel, s.viewLayers);
    this.syncToolPanel(this.tagsPanel, s.viewTags);
    this.syncToolPanel(this.minimapPanel, s.viewMinimap);

    this.viewMenu?.refresh();
    this.resizeGraphToContainer();
  }

  private syncToolPanel(panel: ToolPanelLike | null, want: boolean): void {
    if (!panel) return;
    if (want && !panel.isOpen()) panel.open();
    else if (!want && panel.isOpen()) panel.close();
  }

  /** 把 graph 注入各工具窗（在 initGraphEditor 之后调用） */
  private attachViewFeatures(): void {
    if (!this.graph) return;
    this.findPanel?.setGraph(this.graph);
    this.layersPanel?.setGraph(this.graph);
    this.tagsPanel?.setGraph(this.graph);
    this.minimapPanel?.setGraph(this.graph);

    // 图层显隐 / 锁定是「层」级别的状态，最终落在每个 cell 上，打开文件后整层重放一次
    this.layersPanel?.applyAllLayerStates();
  }

  /**
   * mxGraph 只在 window.resize 时自动重算容器尺寸，容器自身变化
   * （形状面板 / 面板轨道开关、标尺开关）必须手动通知它。
   */
  private resizeGraphToContainer(): void {
    if (!this.graph) return;
    try {
      this.graph.sizeDidChange();
      const view = this.graph.getView();
      if (view && typeof view.validate === "function") view.validate();
    } catch (err) {
      console.error("Error resizing graph:", err);
    }
    this.updateGridBackground();
    this.ruler?.update(this.graph);
    this.minimapPanel?.scheduleRender();
  }

  /** 浮动工具窗拖动 / 缩放后落盘几何信息（只存 UI 状态，不惊动 mxGraph） */
  private patchPanelGeometry(id: string, geo: PanelGeometry): void {
    this.plugin.settings.panelGeometry[id] = geo;
    void this.plugin.saveData(this.plugin.settings);
  }

  /** 图层面板改动定义后落盘（图层的显隐 / 锁定由面板自己重放到模型上） */
  private saveLayers(layers: LayerDef[]): void {
    this.plugin.settings.layers = layers;
    void this.plugin.saveData(this.plugin.settings);
  }

  /**
   * 把「绘图」面板的设置落到 mxGraph 上：
   * 网格、参考线、连接点、连线箭头默认值、页面视图与页面尺寸、画布底色。
   */
  applyDiagramSettings(): void {
    if (!this.graph) return;

    const settings = this.plugin.settings;
    const consts = mxConstants();

    // 网格：mxGraph 只拿它做吸附，真正的绘制在 updateGridBackground 的 CSS 层
    this.graph.setGridEnabled(settings.showGrid);
    this.graph.setGridSize(
      settings.gridSize > 0 ? settings.gridSize : DrawioView.GRID_SIZE
    );

    // 参考线：拖动图形时的对齐虚线（mxGraphHandler 默认关闭）
    if (this.graph.graphHandler) {
      this.graph.graphHandler.guidesEnabled = !!settings.guides;
    }

    // 连接点：mxConstraintHandler 负责悬停 / 拖拽时在图形上标出连接点
    const connectionHandler = this.graph.connectionHandler;
    if (connectionHandler && connectionHandler.constraintHandler) {
      connectionHandler.constraintHandler.enabled = !!settings.connectionPoints;
    }

    // 连接箭头：作用在「新建连线」的默认样式上
    const edgeStyle = this.graph.getStylesheet().getDefaultEdgeStyle();
    if (settings.connectionArrows) {
      edgeStyle[consts.STYLE_ENDARROW] = consts.ARROW_CLASSIC;
    } else {
      delete edgeStyle[consts.STYLE_ENDARROW];
    }

    // 页面视图 + 页面尺寸。
    // 关闭时：画布铺满可用区域，无边界、网格满屏（原行为不变）。
    // 开启时：画布容器收缩成「页面单位 × 当前缩放」的矩形块，
    //   100% 缩放时 A4 就是 827×1169 px（96dpi 真实像素），
    //   即 draw.io 的「1:1 页面尺寸预览」；超出视口的部分靠滚动查看。
    //   块本身由 CSS 描边，外层滚动视口负责滚动与留白（见 applyPageViewLayout）。
    // 纸面不再由 mxGraph 画：容器即纸面，边界交给 CSS 描边，
    // 这样网格天然只覆盖纸面、也不会被白色填充盖住。
    const view = this.graph.getView();
    const RectShape = (window as any).mxRectangleShape;
    if (RectShape && !view.__drawioPageShapePatched) {
      view.__drawioPageShapePatched = true;
      view.createBackgroundPageShape = (bounds: any) =>
        new RectShape(bounds, "none", "#8a8f98");
    }

    const MxRectangle = mxRectangle();
    const w = mmToPageUnits(settings.pageWidth || 210);
    const h = mmToPageUnits(settings.pageHeight || 297);
    const landscape = settings.pageOrientation === "landscape";
    // mxGraph 默认 pageScale = 1.5（为打印预留），这里回到 1，
    // A4 才会渲染成 draw.io 里的 827 × 1169
    this.graph.pageScale = 1;
    // 本版纸面层始终关闭（容器即纸面）；pageFormat 仍按纸型维护，
    // 让 mxGraph 内部与页面相关的计算保持一致。
    this.graph.pageVisible = false;
    this.graph.pageFormat = new MxRectangle(
      0,
      0,
      landscape ? h : w,
      landscape ? w : h
    );

    this.applyPageViewLayout();
    this.applyCanvasBackground();
    this.updateGridBackground();
    this.graph.refresh();
  }

  /** 画布底色：启用「背景色」时用用户选的颜色，否则跟随明暗主题 */
  private applyCanvasBackground(): void {
    if (!this.graph) return;
    const settings = this.plugin.settings;
    if (settings.backgroundEnabled && settings.backgroundColor) {
      this.graph.container.style.backgroundColor = settings.backgroundColor;
      return;
    }
    const isDark = document.body.hasClass("theme-dark");
    this.graph.container.style.backgroundColor = isDark ? "#1e1e1e" : "#ffffff";
  }

  /**
   * 页面视图的画布布局 —— 按「页面尺寸」1:1 预览纸面（所见即所得）：
   * - 关闭：画布铺满滚动视口（宽高都撑满），无边框。
   * - 开启：画布收缩成「页面单位 × 当前缩放」的矩形块。因为 100% 缩放时
   *   A4 就是 827×1169 px（96dpi 真实像素），块通常比视口大，靠外层滚动视口滚动。
   *
   * 滚动视口用 grid + `safe center`：块装得下就居中，装不下就退化成从起点对齐，
   * 保证左上角永远滚得到（普通 center 会把溢出的上/左侧推到滚动区之外）。
   * 给块的父级加 padding，块比视口小时四周才不会贴边。
   *
   * 容器尺寸一旦变化必须手动通知 mxGraph（它没有 ResizeObserver），
   * 所以最后统一走 resizeGraphToContainer()。
   */
  private applyPageViewLayout(): void {
    if (!this.graph || !this.graphContainer || !this.canvasScrollEl) return;

    const settings = this.plugin.settings;
    const view = this.graph.getView();
    const scale = view.scale || 1;
    const on = !!settings.pageView;

    const container = this.graphContainer;

    if (on) {
      // 页面的「模型单位」尺寸 → 屏幕像素：px = 单位 × scale
      const w = mmToPageUnits(settings.pageWidth || 210);
      const h = mmToPageUnits(settings.pageHeight || 297);
      const landscape = settings.pageOrientation === "landscape";
      const pageW = landscape ? h : w;
      const pageH = landscape ? w : h;

      // 注：本构建里 mxGraph.resizeContainer 默认为 false，
      // sizeDidChange() 不会回写容器尺寸，所以这里给的宽高不会被抹掉。
      // 尺寸是算出来的 → 落成自定义属性，由 .drawio-page-block 的 var() 消费。
      setCssVars(container, {
        "--drawio-page-w": `${Math.round(pageW * scale)}px`,
        "--drawio-page-h": `${Math.round(pageH * scale)}px`,
      });
      container.addClass("drawio-page-block");
    } else {
      // 摘掉两个变量即回落到 .drawio-graph-container 自己的 width/height: 100%
      clearCssVars(container, "--drawio-page-w", "--drawio-page-h");
      container.removeClass("drawio-page-block");
    }

    // 页面视图下画布块要能平移：纸面边缘之外的平移量都落在块的父级留白上
    this.syncCanvasTranslateScope(on);

    this.resizeGraphToContainer();
  }

  /**
   * mxGraph 把整幅画布（含 svg 根元素）平移 `translate` 像素。
   * 页面视图下画布块只有纸面那么大，贴着块边界的图形会溢出到块外被裁掉
   * （`.drawio-graph-container` 是 `overflow: hidden`），所以给块四周留出
   * 一块「可平移缓冲」：块外的父级 padding + svg 的 overflow: visible，
   * 让纸面边缘的图形平移时仍然可见。
   */
  private syncCanvasTranslateScope(on: boolean): void {
    const scroll = this.canvasScrollEl;
    const svg = this.graph?.view?.canvas?.ownerSVGElement as SVGElement | null;
    if (scroll) {
      scroll.style.padding = on
        ? `${DrawioView.PAGE_MARGIN}px`
        : "0";
    }
    if (svg) {
      svg.style.overflow = on ? "visible" : "";
    }
  }

  /**
   * 对当前页所有图形写入 / 清除某个样式（「阴影 / 草图 / 圆角 / 自适应颜色」用）。
   * 这些是整图级样式，作用对象是页内全部顶点。
   */
  private applyStyleToPage(key: string, value: string | null): void {
    if (!this.graph) return;
    const model = this.graph.getModel();
    const cells = model.filterDescendants((cell: any) => model.isVertex(cell));
    if (!cells || cells.length === 0) {
      this.drawPanel?.refresh();
      return;
    }
    model.beginUpdate();
    try {
      this.graph.setCellStyles(key, value, cells);
    } finally {
      model.endUpdate();
    }
    this.markDirty();
    this.drawPanel?.refresh();
  }

  /** 读取当前页所有图形共有的某个样式值；不一致或页内无图形时返回 null */
  private getPageStyle(key: string): string | null {
    if (!this.graph) return null;
    const model = this.graph.getModel();
    const cells = model.filterDescendants((cell: any) => model.isVertex(cell));
    if (!cells || cells.length === 0) return null;

    const MxUtils = mxUtils();
    let value: string | null = null;
    let seen = false;
    for (const cell of cells) {
      const style = this.graph.getCellStyle(cell) || {};
      const v = MxUtils.getValue(style, key, null);
      if (!seen) {
        value = v;
        seen = true;
      } else if (v !== value) {
        return null;
      }
    }
    return value;
  }

  /** 「编辑数据…」：以 XML 形式编辑当前页的 mxGraphModel，应用后重载当前页 */
  private editPageData(): void {
    if (!this.graph) return;
    this.captureActivePage();
    const page = this.pages[this.activePage];
    new TextEditModal(this.app, {
      title: t("diagram.editDataTitle"),
      label: t("diagram.editDataLabel"),
      value: page ? page.xml : "",
      hint: t("diagram.editDataHint"),
      onSave: (value) => {
        const xml = value.trim();
        if (!xml) return false;
        try {
          const MxUtils = mxUtils();
          const doc = MxUtils.parseXml(xml);
          if (!doc || !doc.getElementsByTagName("mxGraphModel")[0]) {
            new Notice(t("diagram.editDataInvalid"));
            return false;
          }
        } catch {
          new Notice(t("diagram.editDataInvalid"));
          return false;
        }
        if (page) page.xml = xml;
        this.loadPageIntoGraph(this.activePage);
        this.markDirty();
        this.drawPanel?.refresh();
        return true;
      },
    }).open();
  }

  /** 「清除默认风格」：把默认顶点 / 连线样式恢复成本插件的出厂默认 */
  private clearDefaultStyle(): void {
    if (!this.graph) return;
    const sheet = this.graph.getStylesheet();
    sheet.putDefaultVertexStyle(sheet.createDefaultVertexStyle());
    sheet.putDefaultEdgeStyle(sheet.createDefaultEdgeStyle());
    // 重新套用本插件的主题化默认（透明填充 / 描边色）、默认连线走线方式与面板里的默认样式项
    this.applyTheme();
    this.applySettings();
    this.drawPanel?.refresh();
    new Notice(t("diagram.defaultStyleCleared"));
  }

  /**
   * 右键上下文菜单：在画布图形 / 连线上右键弹出 draw.io 风格的操作菜单。
   * 自绘 DOM 菜单（不依赖 mxGraph 自带的 mxPopupMenu），便于完全掌控样式与交互。
   */
  private setupContextMenu(): void {
    if (!this.graph || !this.graphContainer) return;

    const graph: any = this.graph;
    const MxUtils = mxUtils();

    // 禁用 mxGraph 自带的右键弹出菜单，避免与我们的自定义菜单重复 / 冲突
    if (
      graph.popupMenuHandler &&
      typeof graph.popupMenuHandler.setEnabled === "function"
    ) {
      graph.popupMenuHandler.setEnabled(false);
    }

    // 菜单元素：挂在 body 上（position: fixed），可溢出画布容器
    if (!this.ctxMenuEl) {
      // 显隐走 .drawio-hidden 工具类（默认隐藏，右键时才露出）
      this.ctxMenuEl = document.body.createDiv({
        cls: "drawio-ctx-menu drawio-hidden",
      });
      // 统一用事件委托处理菜单项点击
      this.ctxMenuEl.addEventListener("click", (e: MouseEvent) => {
        const item = (e.target as HTMLElement).closest(
          ".drawio-ctx-item"
        ) as HTMLElement | null;
        if (!item || item.classList.contains("drawio-ctx-disabled")) return;
        const action = item.dataset.action;
        if (action) {
          this.ctxAction(action, this.ctxTargetCell);
        }
      });
    }

    // 画布上的右键 → 检测单元格并弹出菜单
    this.registerDomEvent(this.graphContainer, "contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      if (!this.graph) return;

      // 坐标语义（关键）：mxGraph 的 state.x/y 是「容器像素坐标」——
      // updateCellState 里 state.x = scale*(translate.x + origin.x)，
      // 所以 getCellAt 要的是容器像素（与 mxUtils.convertPoint 的结果同一空间），
      // **不是**模型/图坐标。切勿再除 scale / 减 translate，否则缩放平移后会失准。
      const pt = MxUtils.convertPoint(this.graphContainer, e.clientX, e.clientY);
      const cell = this.graph.getCellAt(pt.x, pt.y);

      // 空白处右键：有剪贴板内容时给出「粘贴」，否则仅抑制原生菜单
      if (!cell) {
        const hasClipboard = !!(
          this.clipboardCells && this.clipboardCells.length > 0
        );
        if (hasClipboard) {
          this.ctxTargetCell = null;
          this.openCtxMenu(e.clientX, e.clientY);
        } else {
          this.closeCtxMenu();
        }
        return;
      }

      // 右键已选中的某个图形时保留多选；否则选中该图形
      if (!this.graph.isCellSelected(cell)) {
        this.graph.setSelectionCell(cell);
      }
      this.ctxTargetCell = cell;
      this.openCtxMenu(e.clientX, e.clientY);
    });
  }

  /** 构建并定位菜单（每次右键都按当前单元格状态重建条目） */
  private openCtxMenu(clientX: number, clientY: number): void {
    const menu = this.ctxMenuEl;
    if (!menu || !this.graph) return;

    const cell = this.ctxTargetCell;
    const hasClipboard = !!(
      this.clipboardCells && this.clipboardCells.length > 0
    );

    // 重建条目
    menu.empty();

    // 空白处右键：只给「粘贴」（与 draw.io 一致）
    if (!cell) {
      this.addCtxItem(menu, t("ctx.paste"), {
        action: "paste",
        shortcut: "Ctrl+V",
      });
      this.showCtxMenu(clientX, clientY);
      return;
    }

    const MxConstants = mxConstants();
    const locked =
      this.graph.getCellStyle(cell)[MxConstants.STYLE_LOCKED] === "1";

    this.addCtxItem(menu, t("ctx.delete"), {
      action: "delete",
      danger: true,
      shortcut: "Del",
    });
    this.addCtxItem(menu, t("ctx.cut"), { action: "cut", shortcut: "Ctrl+X" });
    this.addCtxItem(menu, t("ctx.copy"), { action: "copy", shortcut: "Ctrl+C" });
    this.addCtxItem(menu, t("ctx.duplicate"), {
      action: "duplicate",
      shortcut: "Ctrl+D",
    });
    if (hasClipboard) {
      this.addCtxItem(menu, t("ctx.paste"), {
        action: "paste",
        shortcut: "Ctrl+V",
      });
    }

    this.addCtxSep(menu);

    this.addCtxItem(menu, locked ? t("ctx.unlock") : t("ctx.lock"), {
      action: "lock",
    });
    this.addCtxItem(menu, t("ctx.setDefault"), { action: "default" });

    this.addCtxItem(menu, t("ctx.toFront"), { action: "front" });
    this.addCtxItem(menu, t("ctx.toBack"), { action: "back" });
    this.addCtxItem(menu, t("ctx.forward"), { action: "forward" });
    this.addCtxItem(menu, t("ctx.backward"), { action: "backward" });

    this.addCtxSep(menu);

    this.addCtxItem(menu, t("ctx.editStyle"), { action: "style" });
    this.addCtxItem(menu, t("ctx.editData"), { action: "data" });
    this.addCtxItem(menu, t("ctx.editLink"), { action: "link" });
    this.addCtxItem(menu, t("ctx.editPoints"), { action: "points" });

    this.addCtxSep(menu);

    this.addCtxItem(menu, t("ctx.addToScratchpad"), { action: "scratch" });

    this.showCtxMenu(clientX, clientY);
  }

  /** 显示菜单：量尺寸做视口内钳制，并注册「点击空白 / 滚动 / Esc」关闭监听 */
  private showCtxMenu(clientX: number, clientY: number): void {
    const menu = this.ctxMenuEl;
    if (!menu) return;

    menu.classList.remove("drawio-hidden");
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let x = clientX;
    let y = clientY;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 4;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;

    // 先清掉上一轮可能残留的监听，避免重复注册
    this.removeCtxOutsideListeners();

    this.ctxOutsidePointer = (ev: PointerEvent) => {
      if (!this.ctxMenuEl) return;
      if (!this.ctxMenuEl.contains(ev.target as Node)) this.closeCtxMenu();
    };
    this.ctxOutsideKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") this.closeCtxMenu();
    };
    this.ctxOutsideWheel = () => this.closeCtxMenu();
    document.addEventListener("pointerdown", this.ctxOutsidePointer, true);
    document.addEventListener("keydown", this.ctxOutsideKey);
    this.graphContainer?.addEventListener("wheel", this.ctxOutsideWheel, true);
  }

  /** 注销菜单外的关闭监听 */
  private removeCtxOutsideListeners(): void {
    if (this.ctxOutsidePointer) {
      document.removeEventListener("pointerdown", this.ctxOutsidePointer, true);
      this.ctxOutsidePointer = null;
    }
    if (this.ctxOutsideKey) {
      document.removeEventListener("keydown", this.ctxOutsideKey);
      this.ctxOutsideKey = null;
    }
    if (this.ctxOutsideWheel && this.graphContainer) {
      this.graphContainer.removeEventListener(
        "wheel",
        this.ctxOutsideWheel,
        true
      );
    }
    this.ctxOutsideWheel = null;
  }

  /** 关闭菜单并注销监听 */
  private closeCtxMenu(): void {
    if (this.ctxMenuEl) this.ctxMenuEl.classList.add("drawio-hidden");
    this.ctxTargetCell = null;
    this.removeCtxOutsideListeners();
  }

  private addCtxItem(
    menu: HTMLElement,
    label: string,
    opts: {
      action?: string;
      danger?: boolean;
      shortcut?: string;
      disabled?: boolean;
    }
  ): void {
    const item = menu.createDiv({
      cls:
        "drawio-ctx-item" +
        (opts.danger ? " drawio-ctx-danger" : "") +
        (opts.disabled ? " drawio-ctx-disabled" : ""),
    });
    item.createSpan({ cls: "drawio-ctx-label", text: label });
    if (opts.shortcut) {
      item.createSpan({ cls: "drawio-ctx-shortcut", text: opts.shortcut });
    }
    if (opts.action && !opts.disabled) item.dataset.action = opts.action;
  }

  private addCtxSep(menu: HTMLElement): void {
    menu.createDiv({ cls: "drawio-ctx-sep" });
  }

  /** 菜单项动作分发 */
  private ctxAction(action: string, cell: any): void {
    if (!this.graph) return;
    const graph: any = this.graph;
    const cells = graph.getSelectionCells();

    // 需要具体目标单元格的动作：空白处右键（只有粘贴）时不可达，做防御性拦截
    if (
      !cell &&
      ["default", "style", "data", "link", "points", "scratch"].includes(action)
    ) {
      this.closeCtxMenu();
      return;
    }

    switch (action) {
      case "delete":
        graph.removeCells(cells);
        break;
      case "cut":
        this.copyCells(cells);
        graph.removeCells(cells);
        break;
      case "copy":
        this.copyCells(cells);
        break;
      case "paste":
        this.pasteCells();
        break;
      case "duplicate":
        this.duplicateCells(cells);
        break;
      case "lock":
        this.toggleLock(cells);
        break;
      case "default":
        this.setDefaultStyle(cell);
        break;
      case "front":
        graph.bringToFront(cells);
        break;
      case "back":
        graph.sendToBack(cells);
        break;
      case "forward":
        graph.orderCells(false, cells);
        break;
      case "backward":
        graph.orderCells(true, cells);
        break;
      case "style":
        this.closeCtxMenu();
        this.editStyle(cell);
        return; // 弹窗自带关闭菜单
      case "data":
        this.closeCtxMenu();
        this.editData(cell);
        return;
      case "link":
        this.closeCtxMenu();
        this.editLink(cell);
        return;
      case "points":
        this.closeCtxMenu();
        this.editPoints(cell);
        return;
      case "scratch":
        this.addToScratchpad(cell);
        break;
      default:
        this.closeCtxMenu();
        return;
    }

    if (action !== "copy" && action !== "default") this.markDirty();
    this.closeCtxMenu();
  }

  /** 复制 / 剪切：把选中单元格克隆进内部剪贴板（同时重置粘贴偏移计数） */
  private copyCells(cells: any[]): void {
    if (!this.graph || cells.length === 0) return;
    this.clipboardCells = this.graph.cloneCells(cells);
    this.clipboardPasteCount = 0;
  }

  /**
   * 创建副本：用 mxGraph 自己的 moveCells(clone=true) 完成「克隆 + 平移 + 加入」。
   * 相比手工 cloneCells + addCells，它能正确处理连线的终点引用、组合子节点与
   * 边的控制点，落点也带一点偏移不会与原图形完全重叠。
   */
  private duplicateCells(cells: any[]): void {
    if (!this.graph || cells.length === 0) return;
    const graph: any = this.graph;
    const clones = graph.moveCells(
      cells,
      10,
      10,
      true,
      graph.getDefaultParent()
    );
    if (clones && clones.length > 0) graph.setSelectionCells(clones);
  }

  /** 粘贴：把剪贴板内容克隆到画布，逐次递增偏移，避免多次粘贴完全重叠 */
  private pasteCells(): void {
    if (!this.graph || !this.clipboardCells || this.clipboardCells.length === 0) {
      return;
    }
    const graph: any = this.graph;
    this.clipboardPasteCount += 1;
    const off = 10 * this.clipboardPasteCount;
    const pasted = graph.moveCells(
      this.clipboardCells,
      off,
      off,
      true,
      graph.getDefaultParent()
    );
    if (pasted && pasted.length > 0) graph.setSelectionCells(pasted);
  }

  private toggleLock(cells: any[]): void {
    if (!this.graph || cells.length === 0) return;
    const MxConstants = mxConstants();
    const model = this.graph.getModel();
    const key = MxConstants.STYLE_LOCKED;
    const allLocked = cells.every(
      (c: any) => this.graph.getCellStyle(c)[key] === "1"
    );
    const val = allLocked ? null : "1";
    model.beginUpdate();
    try {
      this.graph.setCellStyles(key, val, cells);
    } finally {
      model.endUpdate();
    }
  }

  /** 把选中图形的样式设为新建图形的默认样式（对齐 draw.io 语义：整体替换） */
  private setDefaultStyle(cell: any): void {
    if (!this.graph) return;
    const MxUtils = mxUtils();
    const model = this.graph.getModel();
    const sheet = this.graph.getStylesheet();
    const ownStyle = model.getStyle(cell) || "";
    const parsed = MxUtils.parseStyle(ownStyle);
    const target = model.isEdge(cell)
      ? sheet.getDefaultEdgeStyle()
      : sheet.getDefaultVertexStyle();
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, parsed);
    this.graph.refresh();
  }

  private editStyle(cell: any): void {
    if (!this.graph) return;
    const model = this.graph.getModel();
    const cur = model.getStyle(cell) || "";
    new TextEditModal(this.app, {
      title: t("ctx.modal.styleTitle"),
      label: t("ctx.modal.styleLabel"),
      value: cur,
      multiline: true,
      onSave: (v: string) => {
        model.beginUpdate();
        try {
          this.graph.setCellStyle(v, [cell]);
        } finally {
          model.endUpdate();
        }
        this.markDirty();
      },
    }).open();
  }

  private editLink(cell: any): void {
    if (!this.graph) return;
    const MxConstants = mxConstants();
    const cur = this.graph.getCellStyle(cell)[MxConstants.STYLE_URL] || "";
    new TextEditModal(this.app, {
      title: t("ctx.modal.linkTitle"),
      label: t("ctx.modal.linkLabel"),
      value: cur,
      multiline: false,
      onSave: (v: string) => {
        this.graph.setCellStyles(
          MxConstants.STYLE_URL,
          v.trim() || null,
          [cell]
        );
        this.markDirty();
      },
    }).open();
  }

  private editData(cell: any): void {
    if (!this.graph) return;
    const model = this.graph.getModel();
    const cur = model.getValue(cell);
    let curStr = "";
    if (cur != null) {
      curStr = valueToText(cur);
    }
    new TextEditModal(this.app, {
      title: t("ctx.modal.dataTitle"),
      label: t("ctx.modal.dataLabel"),
      value: curStr,
      multiline: true,
      onSave: (v: string) => {
        model.beginUpdate();
        try {
          model.setValue(cell, v);
        } finally {
          model.endUpdate();
        }
        this.markDirty();
      },
    }).open();
  }

  private editPoints(cell: any): void {
    if (!this.graph) return;
    const MxConstants = mxConstants();
    const cur = this.graph.getCellStyle(cell)[MxConstants.STYLE_POINTS] || "";
    new TextEditModal(this.app, {
      title: t("ctx.modal.pointsTitle"),
      label: t("ctx.modal.pointsLabel"),
      value: cur,
      multiline: false,
      placeholder: "0.5,0;1,0.5",
      hint: t("ctx.modal.pointsHint"),
      onSave: (v: string) => {
        this.graph.setCellStyles(
          MxConstants.STYLE_POINTS,
          v.trim() || null,
          [cell]
        );
        this.graph.refresh();
        this.markDirty();
      },
    }).open();
  }

  /** 把当前图形存入便签本（持久化），并刷新形状面板的便签本分组 */
  private addToScratchpad(cell: any): void {
    if (!this.graph) return;
    const model = this.graph.getModel();
    const style = model.getStyle(cell) || "";
    const value = model.getValue(cell);
    let valueStr = "";
    if (value != null) {
      valueStr = valueToText(value);
    }
    const geo = model.getGeometry(cell);
    const isEdge = model.isEdge(cell);
    const def: ScratchShape = {
      style,
      value: valueStr,
      width: geo ? geo.width : isEdge ? 100 : 120,
      height: geo ? geo.height : isEdge ? 60 : 60,
      icon: isEdge ? "M4,16 L4,8 L20,8 L20,2" : "M3,3 L21,3 L21,13 L3,13 Z",
      isEdge,
    };
    this.plugin.settings.scratchpad.push(def);
    void this.plugin.saveSettings();
    new Notice(t("notice.addedToScratchpad"));
    this.rebuildScratchSection();
  }

  /**
   * 画布导航交互（对齐 draw.io 习惯）：
   * - Ctrl+滚轮：以鼠标位置为锚点缩放（触摸板双指缩放派发的 wheel 自带 ctrlKey，同样生效）
   * - Ctrl+左键拖拽（空白处）/ 空格+左键拖拽 / 中键拖拽 / 右键拖拽 / Ctrl+Shift+拖拽：平移画布
   * - 空白处左键拖拽：框选（mxRubberband，保持原状）
   */
  private setupCanvasNavigation(): void {
    if (!this.graph || !this.graphContainer) return;

    const container = this.graphContainer;
    const graph: any = this.graph;
    const MxEvent = mxEvent();

    // 启用平移：右键拖拽与 Ctrl+Shift+拖拽是 mxPanningHandler 原生触发键
    graph.setPanning(true);

    const panningHandler = graph.panningHandler;

    // 补充中键拖拽、Ctrl+左键拖拽（仅空白处）平移，保留原生触发键。
    // Ctrl+左键限定空白处：按在图形上时保留 mxGraph 默认的 Ctrl 多选/拖动图形
    panningHandler.isPanningTrigger = function (me: any) {
      const evt = me.getEvent();
      // 右键（弹出菜单触发键）整体让给上下文菜单，不参与平移，
      // 与 draw.io 一致：右键出菜单、平移改由中键 / Ctrl+左键(空白) / 空格 / Ctrl+Shift 承担
      return (
        (this.useLeftButtonForPanning &&
          me.getState() == null &&
          MxEvent.isLeftMouseButton(evt)) ||
        (MxEvent.isControlDown(evt) && MxEvent.isShiftDown(evt)) ||
        MxEvent.isMiddleMouseButton(evt) ||
        (MxEvent.isControlDown(evt) &&
          MxEvent.isLeftMouseButton(evt) &&
          me.getState() == null)
      );
    };

    // 平移进行中把光标钉在 grabbing 上（中键/右键/空格拖拽统一反馈）
    graph.addListener(MxEvent.PAN_START, () => container.addClass("drawio-panning"));
    graph.addListener(MxEvent.PAN_END, () => container.removeClass("drawio-panning"));

    // 空格按住进入平移模式：左键拖拽（即使按在图形上）都变成平移
    const setPanMode = (on: boolean) => {
      // ignoreCell 让平移优先于拖动图形；useLeftButtonForPanning 让左键拖空白触发平移
      panningHandler.useLeftButtonForPanning = on;
      panningHandler.ignoreCell = on;
      container.toggleClass("drawio-pan-ready", on);
    };
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      // 鼠标悬停在画布上才接管空格，避免干扰 Obsidian 其他面板
      if (!container.matches(":hover")) return;
      // 正在编辑图形文本时，空格照常输入
      if (typeof graph.isEditing === "function" && graph.isEditing()) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      e.preventDefault();
      setPanMode(true);
    });
    this.registerDomEvent(document, "keyup", (e: KeyboardEvent) => {
      if (e.code === "Space") setPanMode(false);
    });
    // 窗口失焦兜底退出平移模式（如按住空格时切走窗口）
    this.registerDomEvent(window, "blur", () => setPanMode(false));

    // 滚轮：仅 Ctrl+滚轮缩放。passive:false 才能 preventDefault
    // （不拦的话 Ctrl+滚轮会缩放整个 Obsidian 界面）
    this.registerDomEvent(
      container,
      "wheel",
      (e: WheelEvent) => this.handleCanvasWheel(e),
      { passive: false }
    );
  }

  /**
   * 左键框选（对齐 draw.io 的选中矩形效果）。
   *
   * ⚠️ 坐标语义（v0.11.0 修正，此前理解有误）：`mxRubberband` 的
   * this.x / this.y / width / height 是**容器像素坐标**（repaint 里
   * `div.style.left = this.x` 直接用它）。而 mxGraph 的
   * `mxCellState.x/y` 同样落在容器像素空间——`updateCellState` 里
   * `state.x = scale * (translate.x + origin.x)`。两边同空间，
   * 所以 `mxUtils.intersects(rect, state)` 必须**直接用像素矩形**，
   * 不能再做 `px / scale - translate` 的「反投影」。
   *
   * 佐证：mxGraph 自带的 `mxRubberband.execute` → `graph.selectRegion(rect)`
   * → `graph.getCells(rect.x, rect.y, rect.width, rect.height)`，
   * 全程把 this.x 原样透传，且 `getCells` 内部直接拿 `state.x` 与入参比较。
   * 之前的反投影在 translate/scale 为默认值(0/1)时恰好是恒等变换才没暴露问题，
   * 一旦点过「适应画布」或缩放平移就会整体错位、框选失效。
   *
   * 判定语义：**相交即选中**（只要框选矩形碰到/压住图形/连线就选中），而非
   * draw.io 默认的「完全包含才选中」。否则鼠标从形状旁边起框、只框到一半时，
   * 形状整块没被包进去就不会被选中，体验不符合直觉。
   */
  private setupRubberbandSelection(): void {
    if (!this.graph) return;

    const graph: any = this.graph;
    const MxRubberband = mxRubberband();
    const MxRectangle = mxRectangle();
    const MxUtils = mxUtils();
    const MxConstants = mxConstants();

    const rubberband = new MxRubberband(graph);

    // 由 rubberband 当前的 this.x/width 直接得到容器像素矩形（无需任何换算）
    const currentRegion = () => {
      const x = Math.min(rubberband.x, rubberband.x + rubberband.width);
      const y = Math.min(rubberband.y, rubberband.y + rubberband.height);
      return new MxRectangle(
        x,
        y,
        Math.abs(rubberband.width),
        Math.abs(rubberband.height)
      );
    };

    // 收集与给定矩形「相交」的所有图形/连线（含旋转、可见性过滤）。
    // 用 mxUtils.intersects 做相交判定，而不是 getCells 的严格包含，
    // 这样只要框选矩形碰到图形就会被选中。
    const collectIntersecting = (rect: any): any[] => {
      const parent = graph.getDefaultParent();
      const result: any[] = [];
      const visit = (cell: any) => {
        const model = graph.getModel();
        const cnt = model.getChildCount(cell);
        for (let i = 0; i < cnt; i++) {
          const child = model.getChildAt(cell, i);
          const state = graph.view.getState(child);
          if (state && graph.isCellVisible(child)) {
            let bb: any = state;
            const rot =
              MxUtils.getValue(state.style, MxConstants.STYLE_ROTATION) || 0;
            if (rot !== 0) bb = MxUtils.getBoundingBox(state, rot);
            if (MxUtils.intersects(rect, bb)) result.push(child);
          }
          visit(child);
        }
      };
      if (parent) visit(parent);
      return result;
    };

    // mouseUp：选中所有与框选矩形相交的图形/连线（替换当前选择）
    rubberband.execute = function (evt?: any) {
      if (this.x == null || this.y == null) return;
      const raw = collectIntersecting(currentRegion());
      const cells = raw.filter((c: any) => graph.isCellSelectable(c));
      this.graph.setSelectionCells(cells);
    };

    // 拖拽途中实时算出「真正会被选中」的图形数量，给矩形加粗作为反馈
    const originalRepaint = rubberband.repaint;
    rubberband.repaint = function (...args: any[]) {
      originalRepaint.apply(this, args);
      if (!this.div || this.first == null) return;
      const hits = collectIntersecting(currentRegion());
      if (hits && hits.length > 0) {
        this.div.classList.add("mxRubberband-preview");
      } else {
        this.div.classList.remove("mxRubberband-preview");
      }
    };

    // 淡出控制：只在框接近铺满画布时才走 200ms 淡出动画；
    // 小框选松手后立即消失，否则选中结果像「延迟出现」。
    // ⚠️ 注意：不得影响 isActive 的真值（mouseUp 靠它决定是否调用 execute），
    //       所以淡出判断只用于 reset 内部的 fadeOut 分支，不在这里拦截。
    const prevIsActive = rubberband.isActive;
    rubberband.isActive = function (...args: any[]) {
      // 始终透传原始真假值，保证 execute 正常触发
      const active = prevIsActive.apply(this, args);
      if (!active) return false;
      // 额外记录「是否该淡出」到实例上，供覆写的 reset 读取
      const container = graph.container as HTMLElement;
      const w = container.clientWidth || 0;
      const h = container.clientHeight || 0;
      if (w <= 0 || h <= 0 || !this.div) return true;
      const nearW =
        this.width >= w - DrawioView.RUBBERBAND_FADE_EDGE ||
        this.width / w >= DrawioView.RUBBERBAND_FADE_RATIO;
      const nearH =
        this.height >= h - DrawioView.RUBBERBAND_FADE_EDGE ||
        this.height / h >= DrawioView.RUBBERBAND_FADE_RATIO;
      (this as any)._shouldFade = nearW && nearH;
      return true; // 永远返回 true，不让淡出逻辑阻断 select
    };

    // 覆写 reset：根据 _shouldFade 决定是否走淡出（原始 reset 读 this.fadeOut，
    // 我们在这里临时把它改成和 _shouldFade 一致）
    const originalReset = rubberband.reset;
    rubberband.reset = function (...args: any[]) {
      if (this.div) {
        const shouldFade = (this as any)._shouldFade === true;
        // 临时覆盖 fadeOut 让原始 reset 走正确的分支
        const origFadeOut = this.fadeOut;
        this.fadeOut = shouldFade;
        originalReset.apply(this, args);
        this.fadeOut = origFadeOut;
      } else {
        originalReset.apply(this, args);
      }
    };
  }

  /**
   * 悬停方向箭头：鼠标悬停在图形上时，在四周显示上/下/左/右四个蓝色圆点箭头，
   * 点击并拖拽即可从对应方向创建连线。效果对齐图片中的 draw.io 风格。
   */
  private setupHoverConnectArrows(): void {
    if (!this.graph) return;

    const MxImage = mxImage();
    const MxConnectionConstraint = mxConnectionConstraint();
    const MxPoint = mxPoint();
    const MxGraph = mxGraph();
    const consts = mxConstants();

    // 让整个单元格都可触发连接高亮（默认 0.5 只中心区域）
    consts.DEFAULT_HOTSPOT = 1;

    // 四个方向的连接约束点：上 / 右 / 下 / 左
    const originalGetAllConnectionConstraints =
      MxGraph.prototype.getAllConnectionConstraints;
    this.graph.getAllConnectionConstraints = (state: any, source: boolean) => {
      if (!state || !this.graph?.isCellConnectable(state.cell)) return null;
      // 优先保留 stencil 自带的连接约束；没有时才用默认四个方向
      const original = originalGetAllConnectionConstraints.call(
        this.graph,
        state,
        source
      );
      if (original && original.length > 0) return original;
      return [
        new MxConnectionConstraint(new MxPoint(0.5, 0), true), // top
        new MxConnectionConstraint(new MxPoint(1, 0.5), true), // right
        new MxConnectionConstraint(new MxPoint(0.5, 1), true), // bottom
        new MxConnectionConstraint(new MxPoint(0, 0.5), true), // left
      ];
    };

    // 为每个方向约束点渲染不同的箭头图标
    const arrowSvgs = this.buildConnectArrowSvgs();
    const ch = this.graph.connectionHandler.constraintHandler;
    const originalGetImage = ch.getImageForConstraint.bind(ch);
    ch.getImageForConstraint = (state: any, constraint: any, point: any) => {
      const p = constraint.point as { x: number; y: number };
      let key: "top" | "right" | "bottom" | "left" = "top";
      if (p.x === 0 && p.y === 0.5) key = "left";
      else if (p.x === 1 && p.y === 0.5) key = "right";
      else if (p.x === 0.5 && p.y === 0) key = "top";
      else if (p.x === 0.5 && p.y === 1) key = "bottom";

      const cached = arrowSvgs[key];
      if (cached) return new MxImage(cached, 18, 18);
      return originalGetImage(state, constraint, point);
    };

    // 拖拽到空白处时自动创建目标节点，与 draw.io 行为一致
    this.graph.connectionHandler.setCreateTarget(true);
  }

  /**
   * 生成四个方向（上/右/下/左）的连接箭头图标 base64 data URI。
   * 每个图标为 18x18 的蓝色圆点 + 白色向外箭头。
   */
  private buildConnectArrowSvgs(): Record<"top" | "right" | "bottom" | "left", string> {
    const toDataUri = (svg: string) => "data:image/svg+xml;base64," + btoa(svg);
    return {
      top: toDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="#4dabf7" stroke="#ffffff" stroke-width="1.5"/><path d="M9 10V6M7 7l2-2 2 2" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      ),
      right: toDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="#4dabf7" stroke="#ffffff" stroke-width="1.5"/><path d="M8 9h4M11 7l2 2-2 2" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      ),
      bottom: toDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="#4dabf7" stroke="#ffffff" stroke-width="1.5"/><path d="M9 8v4M7 11l2 2 2-2" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      ),
      left: toDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="#4dabf7" stroke="#ffffff" stroke-width="1.5"/><path d="M10 9H6M7 7l-2 2 2 2" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      ),
    };
  }

  private handleCanvasWheel(e: WheelEvent): void {
    if (!this.graph || !this.graphContainer) return;
    // 只接管 Ctrl+滚轮（含触摸板双指缩放），普通滚轮放行默认行为
    if (!e.ctrlKey) return;
    e.preventDefault();

    const view = this.graph.getView();
    const rect = this.graphContainer.getBoundingClientRect();
    // deltaMode=1 是按行（Firefox 鼠标），按每行约 33px 折算
    const deltaY = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;

    // Ctrl+滚轮：以鼠标位置为锚点缩放
    const factor = Math.exp(-deltaY * DrawioView.WHEEL_ZOOM_SENSITIVITY);
    const newScale = Math.min(
      DrawioView.ZOOM_MAX,
      Math.max(DrawioView.ZOOM_MIN, view.scale * factor)
    );
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // 缩放前鼠标指向的图坐标
    const gx = sx / view.scale - view.translate.x;
    const gy = sy / view.scale - view.translate.y;
    // 缩放并平移补偿，让 (gx, gy) 仍落在鼠标位置
    view.scaleAndTranslate(newScale, sx / newScale - gx, sy / newScale - gy);
  }

  /** 应用用户设置：绘图面板的全部选项 + 新建连线的默认走线方式 */
  applySettings(): void {
    if (!this.graph) return;

    const settings = this.plugin.settings;
    const consts = mxConstants();
    const pagesCfg = `${settings.pageSizePreset}|${settings.pageWidth}x${settings.pageHeight}|${settings.pageOrientation}`;

    this.applyDiagramSettings();
    this.applyViewSettings();

    // 页面视图下纸面尺寸变了：滚回纸面左上角，否则用户会盯着旧位置、
    // 换了纸型也看不出变化（越界时会自动夹到最大滚动量）。
    if (this.plugin.settings.pageView && this.lastPagesCfg !== pagesCfg) {
      this.lastPagesCfg = pagesCfg;
      window.requestAnimationFrame(() => this.scrollCanvasToOrigin());
    } else {
      this.lastPagesCfg = pagesCfg;
    }

    const edgeStyle = this.graph.getStylesheet().getDefaultEdgeStyle();
    if (settings.defaultEdgeStyle === "straight") {
      edgeStyle[consts.STYLE_EDGE] = null;
      edgeStyle[consts.STYLE_ROUNDED] = false;
    } else {
      edgeStyle[consts.STYLE_EDGE] = consts.EDGESTYLE_ORTHOGONAL;
      edgeStyle[consts.STYLE_ROUNDED] = true;
    }

    this.graph.refresh();
  }

  /** 把滚动视口滚回纸面左上角（越界时浏览器会自动夹到最大滚动量） */
  private scrollCanvasToOrigin(): void {
    const scroll = this.canvasScrollEl;
    if (!scroll) return;
    const pad = DrawioView.PAGE_MARGIN;
    scroll.scrollTo({ left: pad, top: pad });
  }

  applyTheme(): void {
    if (!this.graph) return;

    const isDark = document.body.hasClass("theme-dark");
    const textColor = isDark ? "#dcddde" : "#333333";

    this.applyCanvasBackground();
    this.graph.container.style.color = textColor;

    const stylesheet = this.graph.getStylesheet();
    const consts = mxConstants();
    const defaults = stylesheet.getDefaultVertexStyle();
    defaults[consts.STYLE_FONTCOLOR] = textColor;
    // 图形默认透明填充 + 深灰描边，对齐 draw.io 默认风格
    defaults[consts.STYLE_FILLCOLOR] = "none";
    defaults[consts.STYLE_STROKECOLOR] = isDark ? "#6272a4" : "#333333";

    const edgeDefaults = stylesheet.getDefaultEdgeStyle();
    edgeDefaults[consts.STYLE_STROKECOLOR] = isDark ? "#6272a4" : "#333333";
    edgeDefaults[consts.STYLE_FONTCOLOR] = textColor;

    this.updateGridBackground();
    this.graph.refresh();
  }

  private static readonly GRID_SIZE = 10;
  /**
   * 页面视图下画布块与滚动视口边缘的固定间距（px）。
   * 纯视觉留白 + 可平移缓冲区，与页面尺寸无关，所以不给用户调。
   */
  private static readonly PAGE_MARGIN = 40;
  /** 画布缩放上下限：10% – 800% */
  private static readonly ZOOM_MIN = 0.1;
  private static readonly ZOOM_MAX = 8;
  /** Ctrl+滚轮缩放灵敏度：newScale = oldScale * exp(-delta * 该值)，值越大每格缩放越猛 */
  private static readonly WHEEL_ZOOM_SENSITIVITY = 0.0015;
  /** 拖拽位图（图形轮廓）的正方形边长，单位 px */
  private static readonly DRAG_GHOST_SIZE = 32;
  /** 指针移动超过该距离才判定为拖拽，否则按点击处理，单位 px */
  private static readonly DRAG_THRESHOLD_PX = 4;
  /** 框选矩形铺满画布容器后才允许淡出，短边小于该值直接瞬间移除，单位 px */
  private static readonly RUBBERBAND_FADE_EDGE = 260;
  /** 框选矩形铺满画布容器后才允许淡出，覆盖面积占比达到该值即可 */
  private static readonly RUBBERBAND_FADE_RATIO = 0.6;

  /**
   * mxClient 里的 gridSize 只参与吸附计算，本身不绘制网格，
   * 所以这里用两层 linear-gradient 在容器背景上画一层跟随缩放 / 平移的网格。
   */
  private updateGridBackground(): void {
    if (!this.graph || !this.graphContainer) return;

    const container = this.graphContainer;
    // 容器被折叠 / 面板重排时宽度会变成 0，此时先撤掉网格，等布局稳定再画
    if (!this.plugin.settings.showGrid || !container.clientWidth) {
      clearCssVars(
        container,
        "--drawio-grid-image",
        "--drawio-grid-size",
        "--drawio-grid-pos"
      );
      return;
    }

    const view = this.graph.getView();
    const scale = view.scale || 1;
    const gridSize =
      this.plugin.settings.gridSize > 0
        ? this.plugin.settings.gridSize
        : DrawioView.GRID_SIZE;
    const size = Math.max(4, gridSize * scale);
    const offsetX = (((view.translate.x * scale) % size) + size) % size;
    const offsetY = (((view.translate.y * scale) % size) + size) % size;

    // 网格线颜色：用户在「绘图」面板里选过就用它，否则跟随明暗主题
    const custom = this.plugin.settings.gridColor;
    const line =
      custom && /^#[0-9a-fA-F]{6}$/.test(custom)
        ? custom
        : document.body.hasClass("theme-dark")
        ? "rgba(255, 255, 255, 0.08)"
        : "rgba(0, 0, 0, 0.08)";

    // 网格是算出来的（随缩放 / 平移变化）→ 写成自定义属性，由 styles.css 的 var() 消费
    setCssVars(container, {
      "--drawio-grid-image":
        `linear-gradient(to right, ${line} 1px, transparent 1px), ` +
        `linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
      "--drawio-grid-size": `${size}px ${size}px`,
      "--drawio-grid-pos": `${offsetX}px ${offsetY}px`,
    });
  }

  // ============================================================ 多页（page bar）

  /** 生成一个新页面 id（只需在文件内唯一，格式随意） */
  private nextPageId(): string {
    return (
      "page-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7)
    );
  }

  /** 未占用的默认页名：第1页 / 第2页 …… */
  private defaultPageName(): string {
    let n = 1;
    const taken = new Set(this.pages.map((p) => p.name));
    while (taken.has(t("page.defaultName", { n: String(n) }))) n++;
    return t("page.defaultName", { n: String(n) });
  }

  /** 空白页的模型骨架（与 draw.io 新建页一致：root + 默认父节点） */
  private emptyModelXml(): string {
    return (
      '<mxGraphModel dx="1422" dy="798" grid="1" gridSize="10" guides="1" ' +
      'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" ' +
      'pageWidth="827" pageHeight="1169" math="0" shadow="0">' +
      '<root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel>'
    );
  }

  /** 把当前画布内容序列化回 pages[activePage].xml */
  private captureActivePage(): void {
    if (!this.graph) return;
    if (this.activePage < 0 || this.activePage >= this.pages.length) return;
    try {
      const MxUtils = mxUtils();
      const MxCodec = mxCodec();
      const encoder = new MxCodec();
      const node = encoder.encode(this.graph.getModel());
      this.pages[this.activePage].xml = MxUtils.getXml(node);
    } catch (err) {
      console.error("Error capturing page:", err);
    }
  }

  /**
   * 切页：清空模型 → 解码目标页 → 清空撤销栈。
   * `model.clear()` 会重建只含 root 的干净模型，避免上一页残留的 cell id
   * 与新页冲突；期间屏蔽脏标记，否则切页会被当成一次内容改动而触发写盘。
   */
  private loadPageIntoGraph(index: number): void {
    if (!this.graph) return;
    const MxUtils = mxUtils();
    const MxCodec = mxCodec();
    const page = this.pages[index];
    const model = this.graph.getModel();

    this.suppressDirty = true;
    model.beginUpdate();
    try {
      model.clear();
      const xml = (page && page.xml ? page.xml : "").trim();
      if (xml) {
        const doc = MxUtils.parseXml(xml);
        const node = doc.getElementsByTagName("mxGraphModel")[0];
        if (node) {
          const codec = new MxCodec(doc);
          codec.decode(node, model);
        }
      }
    } catch (err) {
      console.error("Error loading page:", err);
      new Notice(t("notice.loadFailed") + (err as Error).message);
    } finally {
      model.endUpdate();
      this.suppressDirty = false;
    }

    // 撤销栈跨页会串味（页 A 的操作被撤销到页 B 上），每页各自独立
    this.graph.clearSelection();
    if (this.undoManager && typeof this.undoManager.clear === "function") {
      this.undoManager.clear();
    }
    // 新页历史栈是空的，撤销 / 重做回到置灰态
    this.refreshUndoRedoState();
    // 图层显隐 / 锁定要重新落到新页的图形上（幂等，没变化时不会产生脏标记）
    this.layersPanel?.applyAllLayerStates();
    this.updateGridBackground();
    // 换页后「绘图 / 样式」面板要重新回填（阴影 / 草图 / 圆角等跟随当前页内容）
    this.drawPanel?.refresh();
    // 依赖当前页内容的工具窗同步刷新
    this.layersPanel?.refresh();
    this.tagsPanel?.refresh();
    this.findPanel?.refresh();
    this.minimapPanel?.scheduleRender();
    this.ruler?.update(this.graph);
  }

  /** 切换页面 */
  private selectPage(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    if (index === this.activePage) return;
    this.captureActivePage();
    this.activePage = index;
    this.loadPageIntoGraph(index);
    this.pageBar?.render();
  }

  /** 末尾新建一页并激活 */
  private addPage(): void {
    this.captureActivePage();
    this.pages.push({
      id: this.nextPageId(),
      name: this.defaultPageName(),
      xml: this.emptyModelXml(),
    });
    this.activePage = this.pages.length - 1;
    this.loadPageIntoGraph(this.activePage);
    this.pageBar?.render();
    this.markDirty();
  }

  /** 在 index 之后插入一页空白页并激活 */
  private insertPage(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    this.captureActivePage();
    this.pages.splice(index + 1, 0, {
      id: this.nextPageId(),
      name: this.defaultPageName(),
      xml: this.emptyModelXml(),
    });
    this.activePage = index + 1;
    this.loadPageIntoGraph(this.activePage);
    this.pageBar?.render();
    this.markDirty();
  }

  /** 复制一页并放在其后 */
  private duplicatePage(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    if (index === this.activePage) this.captureActivePage();
    const src = this.pages[index];
    const copy: DiagramPage = {
      id: this.nextPageId(),
      name: `${src.name} ${t("page.copySuffix")}`,
      xml: src.xml || this.emptyModelXml(),
    };
    this.pages.splice(index + 1, 0, copy);
    this.activePage = index + 1;
    this.loadPageIntoGraph(this.activePage);
    this.pageBar?.render();
    this.markDirty();
  }

  /** 删除一页（至少保留一页） */
  private deletePage(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    if (this.pages.length <= 1) {
      new Notice(t("notice.lastPageKept"));
      return;
    }
    const removed = this.pages[index];
    this.pages.splice(index, 1);
    if (index < this.activePage) {
      // 删的是前面的页，活动页只需前移一位，画布内容不变
      this.activePage -= 1;
    } else if (index === this.activePage) {
      this.activePage = Math.min(index, this.pages.length - 1);
      this.loadPageIntoGraph(this.activePage);
    }
    this.pageBar?.render();
    this.markDirty();
    new Notice(t("notice.pageDeleted", { name: removed.name }));
  }

  /** 重排页面顺序 */
  private movePage(from: number, to: number): void {
    if (from < 0 || from >= this.pages.length) return;
    if (to < 0 || to >= this.pages.length) return;
    if (from === to) return;
    if (from === this.activePage) this.captureActivePage();
    const [moved] = this.pages.splice(from, 1);
    this.pages.splice(to, 0, moved);
    if (this.activePage === from) this.activePage = to;
    else if (from < this.activePage && to >= this.activePage) this.activePage -= 1;
    else if (from > this.activePage && to <= this.activePage) this.activePage += 1;
    this.pageBar?.render();
    this.markDirty();
  }

  /** 重命名一页 */
  private renamePage(index: number, name: string): void {
    if (index < 0 || index >= this.pages.length) return;
    const next = name.trim();
    if (!next || next === this.pages[index].name) return;
    this.pages[index].name = next;
    this.pageBar?.render();
    this.markDirty();
  }

  /**
   * 从 `<diagram>` 节点提取出 `<mxGraphModel>` 的 XML 文本。
   * 兼容三种写法：① 未压缩、mxGraphModel 作为子元素；
   * ② 未压缩但被转义成了文本；③ draw.io 的压缩格式（base64 + raw deflate）。
   */
  private extractModelXml(diagramNode: Element, doc: Document): string {
    const MxUtils = mxUtils();

    const child = diagramNode.getElementsByTagName("mxGraphModel")[0];
    if (child) return MxUtils.getXml(child);

    const text = (diagramNode.textContent || "").trim();
    if (text) {
      if (text.includes("<")) {
        try {
          const inner = MxUtils.parseXml(text);
          const node = inner.getElementsByTagName("mxGraphModel")[0];
          if (node) return MxUtils.getXml(node);
        } catch {
          // 落到下面的兜底
        }
      } else {
        try {
          return this.decompressDrawio(text);
        } catch {
          // 落到下面的兜底
        }
      }
    }

    const fallback = doc.getElementsByTagName("mxGraphModel")[0];
    return fallback ? MxUtils.getXml(fallback) : "";
  }

  private async loadDiagram(file: TFile): Promise<void> {
    if (!this.graph) return;

    try {
      const content = await this.app.vault.read(file);
      const MxUtils = mxUtils();

      const pages: DiagramPage[] = [];

      if (content.trim()) {
        const doc = MxUtils.parseXml(content);
        const diagramNodes = doc.getElementsByTagName("diagram");

        for (let i = 0; i < diagramNodes.length; i++) {
          const node = diagramNodes[i];
          pages.push({
            id: node.getAttribute("id") || this.nextPageId(),
            name: node.getAttribute("name") || t("page.defaultName", { n: String(i + 1) }),
            xml: this.extractModelXml(node, doc),
          });
        }

        // 没有 <diagram> 包裹、直接是裸 mxGraphModel 的老写法
        if (pages.length === 0) {
          const bare = doc.getElementsByTagName("mxGraphModel")[0];
          if (bare) {
            pages.push({
              id: this.nextPageId(),
              name: t("page.defaultName", { n: "1" }),
              xml: MxUtils.getXml(bare),
            });
          }
        }
      }

      // 空文件 / 无法解析：给一个干净的「第1页」，不丢用户内容
      if (pages.length === 0) {
        pages.push({
          id: this.nextPageId(),
          name: t("page.defaultName", { n: "1" }),
          xml: this.emptyModelXml(),
        });
      }

      this.pages = pages;
      this.activePage = 0;
      this.loadPageIntoGraph(0);
      this.isDirty = false;
      this.loadError = false;
      this.pageBar?.render();
    } catch (err) {
      console.error("Error loading diagram:", err);
      new Notice(t("notice.loadFailed") + (err as Error).message);
      // 解析失败也不让画布空着，但禁止自动保存覆盖原文件
      this.loadError = true;
      this.pages = [
        {
          id: this.nextPageId(),
          name: t("page.defaultName", { n: "1" }),
          xml: this.emptyModelXml(),
        },
      ];
      this.activePage = 0;
      this.loadPageIntoGraph(0);
      this.pageBar?.render();
    }
  }

  /**
   * Decompress draw.io compressed diagram (URL-encoded base64 + raw deflate)
   */
  private decompressDrawio(compressed: string): string {
    // Step 1: URL decode
    let urlDecoded = compressed;
    try {
      urlDecoded = decodeURIComponent(compressed);
    } catch {
      // keep original
    }

    // Step 2: base64 decode
    const binary = atob(urlDecoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Step 3: raw inflate via pako
    const decompressed = inflate(bytes, { raw: true });
    return new TextDecoder().decode(decompressed);
  }

  private markDirty(): void {
    // 切页时重装模型不算内容改动
    if (this.suppressDirty) return;

    this.isDirty = true;

    // 关掉自动保存时只标记脏数据，等用户点工具栏的保存按钮
    if (!this.plugin.settings.autoSave) return;
    // 文件没解析成功：不许自动写盘，避免把原文件清空
    if (this.loadError) return;

    if (this.saveTimeout) window.clearTimeout(this.saveTimeout);
    this.saveTimeout = window.setTimeout(() => {
      this.saveTimeout = null;
      void this.saveDiagram();
    }, this.plugin.settings.autoSaveDelay);
  }

  private async saveManually(): Promise<void> {
    const ok = await this.saveDiagram();
    if (ok) new Notice(t("notice.saved"));
  }

  /**
   * 写盘：把每一页序列化成 `<mxfile>` 下的一个 `<diagram>`（draw.io 原生多页格式）。
   * 当前页从画布实时编码，其余页用内存里缓存的 xml，保证切页前的改动也一起落盘。
   */
  private async saveDiagram(): Promise<boolean> {
    if (!this.graph || !this.file) return false;

    try {
      const MxUtils = mxUtils();
      const MxCodec = mxCodec();

      const encoder = new MxCodec();
      const node = encoder.encode(this.graph.getModel());
      const modelXml = MxUtils.getXml(node);
      if (this.activePage >= 0 && this.activePage < this.pages.length) {
        this.pages[this.activePage].xml = modelXml;
      }

      const diagrams = this.pages.map((page, i) => {
        const name = this.escapeXmlAttr(
          page.name || t("page.defaultName", { n: String(i + 1) })
        );
        const id = this.escapeXmlAttr(page.id);
        const xml = (page.xml || "").trim() || this.emptyModelXml();
        return `  <diagram name="${name}" id="${id}">\n${xml}\n  </diagram>`;
      });

      const content =
        `<mxfile host="obsidian-drawio-editor" modified="${new Date().toISOString()}" version="${this.plugin.manifest.version}">\n` +
        `${diagrams.join("\n")}\n</mxfile>`;

      // process 是「原子地读-改-写」：比 modify 的直接覆盖更安全，
      // 不会和 Obsidian 自己的写入队列打架（@since 1.1.0）。
      await this.app.vault.process(this.file, () => content);
      this.isDirty = false;
      return true;
    } catch (err) {
      console.error("Save error:", err);
      new Notice(t("notice.saveFailed") + (err as Error).message);
      return false;
    }
  }

  private escapeXmlAttr(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private undo(): void {
    if (!this.undoManager) return;
    this.undoManager.undo();
    this.refreshUndoRedoState();
  }

  private redo(): void {
    if (!this.undoManager) return;
    this.undoManager.redo();
    this.refreshUndoRedoState();
  }

  private deleteSelected(): void {
    if (!this.graph) return;
    this.graph.removeCells();
    this.markDirty();
  }

  private clearCanvas(): void {
    if (!this.graph) return;
    const parent = this.graph.getDefaultParent();
    const cells = this.graph.getChildCells(parent);
    if (cells.length === 0) return;

    this.graph.getModel().beginUpdate();
    try {
      this.graph.removeCells(cells, true);
    } finally {
      this.graph.getModel().endUpdate();
    }
    this.markDirty();
  }

  private exportSVG(): void {
    if (!this.graph) return;
    const MxUtils = mxUtils();

    const background = document.body.hasClass("theme-dark") ? "#1e1e1e" : "#ffffff";
    const svgRoot = this.graph.getSvg(background, 1, 0, undefined, undefined, background);

    const svg = MxUtils.getXml(svgRoot);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.body.createEl("a", {
      attr: {
        href: url,
        download: (this.file?.basename ?? "diagram") + ".svg",
      },
    });
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    new Notice(t("notice.svgExported"));
  }

  private cleanup(): void {
    // 自动保存关闭时不强行写盘，避免出现"没点保存却被改了文件"的意外
    if (this.plugin.settings.autoSave && this.isDirty && !this.loadError) {
      void this.saveDiagram();
    }
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.endPaletteDrag();
    this.closeCtxMenu();
    if (this.ctxMenuEl) {
      this.ctxMenuEl.remove();
      this.ctxMenuEl = null;
    }
    // 视图菜单与四个浮动工具窗：菜单挂在 body 上，必须显式销毁
    this.viewMenu?.destroy();
    this.viewMenu = null;
    this.findPanel?.destroy();
    this.findPanel = null;
    this.layersPanel?.destroy();
    this.layersPanel = null;
    this.tagsPanel?.destroy();
    this.tagsPanel = null;
    this.minimapPanel?.destroy();
    this.minimapPanel = null;
    this.ruler?.destroy();
    this.ruler = null;
    if (this.pageBar) {
      this.pageBar.destroy();
      this.pageBar = null;
    }
    if (this.graph) {
      this.graph.destroy();
      this.graph = null;
    }
    this.undoManager = null;
    this.paletteEl = null;
    this.paletteResizeEl = null;
    this.railEl = null;
    this.canvasAreaEl = null;
    this.viewBtnEl = null;
    this.undoBtnEl = null;
    this.redoBtnEl = null;
    this.currentLayerId = DEFAULT_LAYER_ID;
    this.graphContainer = null;
    this.canvasScrollEl = null;
    this.formatPanel = null;
    this.formatPanelEl = null;
    this.drawPanel = null;
    this.diagramPanelEl = null;
    this.scratchSectionEl = null;
    this.scratchGridEl = null;
    this.pages = [];
    this.activePage = 0;
    this.loadError = false;
    this.suppressDirty = false;
  }
}
