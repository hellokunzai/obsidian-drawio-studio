import { MIN_PANEL_H, MIN_PANEL_W, PanelGeometry } from "./settings";
import { t } from "./i18n";
import { setSvgMarkup } from "./svg";

/** 浮动工具窗读写自身几何信息的宿主（实现方负责持久化） */
export interface FloatingPanelHost {
  getGeometry(id: string): PanelGeometry | undefined;
  setGeometry(id: string, geo: PanelGeometry): void;
}

export interface FloatingPanelOptions {
  /** 持久化用的唯一 id */
  id: string;
  title: string;
  /** 默认宽度 / 高度（像素），无持久化几何时使用 */
  width: number;
  height: number;
  /**
   * 默认落点。「right」「bottom」表示相对父容器右 / 下边缘的偏移，
   * 其余情况按左上角像素定位。
   */
  defaultX: number | "right";
  defaultY: number | "bottom";
  onClose: () => void;
}

/** 正在被拖动 / 缩放的面板统一抬到最前，避免互相压住 */
let zTop = 20;

/** 拖动时至少保留在父容器内的像素，避免面板被拖到完全看不见 */
const KEEP_VISIBLE = 48;

/**
 * 浮动工具窗：自绘标题栏（可拖动）+ 内容区 + 右下缩放手柄。
 *
 * 抽出来的原因：视图菜单里的「查找/替换、图层、标签、缩略图」四项在 draw.io 里
 * 都是可拖动、可关闭、记位置的工具窗，行为完全一致，没必要写四遍。
 * 几何信息交给宿主持久化（本插件写进 settings.panelGeometry）。
 */
export class FloatingPanel {
  readonly el: HTMLElement;
  readonly body: HTMLElement;

  private host: FloatingPanelHost;
  private opts: FloatingPanelOptions;
  private parent: HTMLElement;
  private titleEl: HTMLElement;
  private geometry: PanelGeometry;
  private open = false;

  /** 拖动 / 缩放期间挂到 document 上的监听，结束或销毁时必须摘掉 */
  private moveHandler: ((e: PointerEvent) => void) | null = null;
  private upHandler: ((e: PointerEvent) => void) | null = null;
  private parentResizeObserver: ResizeObserver | null = null;

  constructor(
    parent: HTMLElement,
    opts: FloatingPanelOptions,
    host: FloatingPanelHost
  ) {
    this.parent = parent;
    this.opts = opts;
    this.host = host;

    const stored = host.getGeometry(opts.id);
    this.geometry = stored
      ? FloatingPanel.clampGeometry(stored)
      : { x: 0, y: 0, w: opts.width, h: opts.height };

    // 显隐走 .drawio-hidden 工具类；「显示」态由 .drawio-toolwin 自己的 display: flex 决定
    this.el = parent.createDiv({ cls: "drawio-toolwin drawio-hidden" });

    const head = this.el.createDiv({ cls: "drawio-toolwin-head" });
    this.titleEl = head.createSpan({
      cls: "drawio-toolwin-title",
      text: opts.title,
    });

    const closeBtn = head.createEl("button", {
      cls: "drawio-toolwin-close",
      attr: { "aria-label": t("common.close"), type: "button" },
    });
    setSvgMarkup(
      closeBtn,
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
    );
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
    });

    this.body = this.el.createDiv({ cls: "drawio-toolwin-body" });

    const grip = this.el.createDiv({ cls: "drawio-toolwin-grip" });

    head.addEventListener("pointerdown", (e) => this.beginMove(e));
    grip.addEventListener("pointerdown", (e) => this.beginResize(e));
    this.el.addEventListener("pointerdown", () => this.bringToFront());

    // 父容器尺寸变化（窗口缩放、面板开关）后把面板重新钳回可见范围
    if (typeof ResizeObserver !== "undefined") {
      this.parentResizeObserver = new ResizeObserver(() => {
        if (this.open) this.relayout();
      });
      this.parentResizeObserver.observe(parent);
    }
  }

  /** 修正非法几何（外部编辑过插件数据时可能拿到脏值） */
  private static clampGeometry(geo: PanelGeometry): PanelGeometry {
    const num = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fallback;
    return {
      x: num(geo.x, 0),
      y: num(geo.y, 0),
      w: Math.max(MIN_PANEL_W, num(geo.w, MIN_PANEL_W)),
      h: Math.max(MIN_PANEL_H, num(geo.h, MIN_PANEL_H)),
    };
  }

  setTitle(title: string): void {
    this.titleEl.setText(title);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.el.classList.remove("drawio-hidden");
    this.applyGeometry();
    this.bringToFront();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add("drawio-hidden");
    this.endDrag();
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  bringToFront(): void {
    zTop += 1;
    this.el.style.zIndex = String(zTop);
  }

  /** 按当前几何信息写样式（并做一次可见性钳制） */
  private applyGeometry(): void {
    const p = this.parent.getBoundingClientRect();
    const maxX = Math.max(0, p.width - KEEP_VISIBLE);
    const maxY = Math.max(0, p.height - KEEP_VISIBLE);

    // 首次打开：没存过几何信息就按默认落点算一次
    if (!this.host.getGeometry(this.opts.id)) {
      const x =
        this.opts.defaultX === "right"
          ? p.width - this.geometry.w - 16
          : this.opts.defaultX;
      const y =
        this.opts.defaultY === "bottom"
          ? p.height - this.geometry.h - 16
          : this.opts.defaultY;
      this.geometry.x = x;
      this.geometry.y = y;
    }

    this.geometry.x = Math.min(maxX, Math.max(-this.geometry.w + KEEP_VISIBLE, this.geometry.x));
    this.geometry.y = Math.min(maxY, Math.max(0, this.geometry.y));
    if (p.width > 0) {
      this.geometry.w = Math.min(this.geometry.w, Math.max(MIN_PANEL_W, p.width - 8));
    }
    if (p.height > 0) {
      this.geometry.h = Math.min(this.geometry.h, Math.max(MIN_PANEL_H, p.height - 8));
    }

    this.el.style.left = `${Math.round(this.geometry.x)}px`;
    this.el.style.top = `${Math.round(this.geometry.y)}px`;
    this.el.style.width = `${Math.round(this.geometry.w)}px`;
    this.el.style.height = `${Math.round(this.geometry.h)}px`;
  }

  /** 父容器尺寸变化后重新钳位（不改变用户设定的坐标，只保证可见） */
  relayout(): void {
    if (!this.open) return;
    this.applyGeometry();
  }

  /** 内容尺寸变化后请调用：把几何信息落盘，下次打开保持一致 */
  persist(): void {
    this.host.setGeometry(this.opts.id, { ...this.geometry });
  }

  // ---------------------------------------------------------- 拖动 / 缩放

  private beginMove(e: PointerEvent): void {
    // 只认左键 / 触屏，并且不抢标题栏上按钮的点击
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest(".drawio-toolwin-close")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const originX = this.geometry.x;
    const originY = this.geometry.y;
    const p = this.parent.getBoundingClientRect();

    this.beginDrag(
      (ev) => {
        const maxX = Math.max(0, p.width - KEEP_VISIBLE);
        const maxY = Math.max(0, p.height - KEEP_VISIBLE);
        this.geometry.x = Math.min(
          maxX,
          Math.max(-this.geometry.w + KEEP_VISIBLE, originX + (ev.clientX - startX))
        );
        this.geometry.y = Math.min(
          maxY,
          Math.max(0, originY + (ev.clientY - startY))
        );
        this.el.style.left = `${Math.round(this.geometry.x)}px`;
        this.el.style.top = `${Math.round(this.geometry.y)}px`;
      },
      () => this.persist()
    );
  }

  private beginResize(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const originW = this.geometry.w;
    const originH = this.geometry.h;
    const p = this.parent.getBoundingClientRect();

    this.beginDrag(
      (ev) => {
        const maxW = Math.max(MIN_PANEL_W, p.width - this.geometry.x - 4);
        const maxH = Math.max(MIN_PANEL_H, p.height - this.geometry.y - 4);
        this.geometry.w = Math.min(
          maxW,
          Math.max(MIN_PANEL_W, originW + (ev.clientX - startX))
        );
        this.geometry.h = Math.min(
          maxH,
          Math.max(MIN_PANEL_H, originH + (ev.clientY - startY))
        );
        this.el.style.width = `${Math.round(this.geometry.w)}px`;
        this.el.style.height = `${Math.round(this.geometry.h)}px`;
      },
      () => this.persist()
    );
  }

  private beginDrag(
    onMove: (e: PointerEvent) => void,
    onEnd: () => void
  ): void {
    this.endDrag();
    this.bringToFront();
    this.el.addClass("drawio-toolwin-dragging");

    this.moveHandler = (e: PointerEvent) => {
      e.preventDefault();
      onMove(e);
    };
    this.upHandler = () => {
      this.endDrag();
      onEnd();
    };
    document.addEventListener("pointermove", this.moveHandler);
    document.addEventListener("pointerup", this.upHandler);
    document.addEventListener("pointercancel", this.upHandler);
  }

  private endDrag(): void {
    if (this.moveHandler) {
      document.removeEventListener("pointermove", this.moveHandler);
      this.moveHandler = null;
    }
    if (this.upHandler) {
      document.removeEventListener("pointerup", this.upHandler);
      document.removeEventListener("pointercancel", this.upHandler);
      this.upHandler = null;
    }
    this.el.removeClass("drawio-toolwin-dragging");
  }

  destroy(): void {
    this.endDrag();
    this.parentResizeObserver?.disconnect();
    this.parentResizeObserver = null;
    this.el.remove();
  }
}
