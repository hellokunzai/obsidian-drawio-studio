/** 视图菜单里的功能项 */
export type ViewFeatureKey =
  | "shapesPalette"
  | "panelRail"
  | "ruler"
  | "find"
  | "layers"
  | "tags"
  | "minimap";

export interface ViewMenuItem {
  key: ViewFeatureKey;
  label: string;
  checked: boolean;
  /** 与上一项之间画一条分隔线（图一里「标尺」与「查找/替换」之间那条） */
  separatorBefore?: boolean;
  onToggle: () => void;
}

/** 同一时刻只允许一个视图菜单展开（多个 drawio 视图并存时） */
let activeMenu: ViewMenu | null = null;

/**
 * 工具栏最左侧「视图」按钮的下拉菜单。
 *
 * 自绘 DOM 挂在 document.body 上、position: fixed，和画布右键菜单同一套做法——
 * 挂在视图内部会被画布容器/面板轨道裁掉，也没法用 fixed 定位到触发按钮下方。
 */
export class ViewMenu {
  private trigger: HTMLElement;
  private getItems: () => ViewMenuItem[];
  private menuEl: HTMLElement;
  private open = false;

  private outsidePointer: ((e: PointerEvent) => void) | null = null;
  private outsideKey: ((e: KeyboardEvent) => void) | null = null;
  private outsideWheel: (() => void) | null = null;
  private onReposition: (() => void) | null = null;

  constructor(trigger: HTMLElement, getItems: () => ViewMenuItem[]) {
    this.trigger = trigger;
    this.getItems = getItems;

    // 显隐走 .drawio-hidden 工具类（display: none !important），别写内联样式
    this.menuEl = document.body.createDiv({
      cls: "drawio-viewmenu drawio-hidden",
    });

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  openMenu(): void {
    if (activeMenu && activeMenu !== this) activeMenu.close();

    this.render();
    this.menuEl.classList.remove("drawio-hidden");
    this.place();
    this.open = true;
    activeMenu = this;
    this.trigger.addClass("is-open");

    this.outsidePointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (this.menuEl.contains(t) || this.trigger.contains(t))) return;
      this.close();
    };
    this.outsideKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.close();
    };
    this.outsideWheel = () => this.close();
    this.onReposition = () => this.place();

    // 用 capture 阶段，保证点击落在画布上时也先关菜单
    document.addEventListener("pointerdown", this.outsidePointer, true);
    document.addEventListener("keydown", this.outsideKey, true);
    document.addEventListener("wheel", this.outsideWheel, { passive: true });
    window.addEventListener("resize", this.onReposition);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.menuEl.classList.add("drawio-hidden");
    this.trigger.removeClass("is-open");

    if (this.outsidePointer) {
      document.removeEventListener("pointerdown", this.outsidePointer, true);
      this.outsidePointer = null;
    }
    if (this.outsideKey) {
      document.removeEventListener("keydown", this.outsideKey, true);
      this.outsideKey = null;
    }
    if (this.outsideWheel) {
      document.removeEventListener("wheel", this.outsideWheel);
      this.outsideWheel = null;
    }
    if (this.onReposition) {
      window.removeEventListener("resize", this.onReposition);
      this.onReposition = null;
    }
    if (activeMenu === this) activeMenu = null;
  }

  /** 重新渲染（外部状态变化后调用，菜单开着时才刷新） */
  refresh(): void {
    if (!this.open) return;
    this.render();
    this.place();
  }

  private render(): void {
    this.menuEl.empty();
    const items = this.getItems();

    for (const item of items) {
      if (item.separatorBefore) {
        this.menuEl.createDiv({ cls: "drawio-viewmenu-sep" });
      }
      const row = this.menuEl.createDiv({ cls: "drawio-viewmenu-item" });
      if (item.checked) row.addClass("is-checked");

      const tick = row.createSpan({ cls: "drawio-viewmenu-tick" });
      tick.setText("\u2713");
      row.createSpan({ cls: "drawio-viewmenu-text", text: item.label });

      row.addEventListener("click", () => {
        item.onToggle();
        // 勾选状态立刻反映到菜单上，不关菜单（draw.io 同行为）
        this.render();
        this.place();
      });
    }
  }

  /** 定位到触发按钮正下方；空间不够时上翻 / 贴边 */
  private place(): void {
    const r = this.trigger.getBoundingClientRect();
    const mw = this.menuEl.offsetWidth;
    const mh = this.menuEl.offsetHeight;

    let left = r.left;
    let top = r.bottom + 4;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;

    this.menuEl.style.left = `${Math.round(Math.max(8, left))}px`;
    this.menuEl.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  destroy(): void {
    this.close();
    this.menuEl.remove();
  }
}
