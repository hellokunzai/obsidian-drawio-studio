import { t } from "./i18n";
import { setSvgMarkup } from "./svg";
import { setCssVars, clearCssVars } from "./cssVars";

/** 页面栏只关心「标识 + 显示名」，模型数据由宿主（DrawioView）保管 */
export interface PageBarPage {
  id: string;
  name: string;
}

/**
 * 页面栏与宿主的交互契约。页面栏自身不改动 pages 数组，
 * 所有增删改移都回抛给宿主，宿主改完数据后重新 render。
 */
export interface PageBarHost {
  /** 当前页列表快照 */
  getPages(): PageBarPage[];
  /** 当前活动页下标 */
  getActiveIndex(): number;
  /** 切换到某一页 */
  selectPage(index: number): void;
  /** 在末尾追加一页并激活 */
  addPage(): void;
  /** 重命名某一页 */
  renamePage(index: number, name: string): void;
  /** 在指定页之后插入一页空白页 */
  insertPage(index: number): void;
  /** 复制指定页并放在其后 */
  duplicatePage(index: number): void;
  /** 删除指定页（只剩一页时宿主会拒绝并提示） */
  deletePage(index: number): void;
  /** 把 from 位置的页移动到 to 位置 */
  movePage(from: number, to: number): void;
}

const SVG_CARET =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
const SVG_PLUS =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
const SVG_MENU =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';

/**
 * 画布底部页面栏（对齐 draw.io 的 page bar）。
 *
 * DOM 结构：
 *   .drawio-pagebar
 *     button.drawio-pagebar-menu      —— ⋮ 打开当前页菜单
 *     .drawio-pagebar-tabs            —— 页签条（横向滚动）
 *        .drawio-pagebar-tab[.is-active]
 *           span.drawio-pagebar-tab-name
 *           button.drawio-pagebar-caret（仅活动页）—— ^ 打开菜单
 *        .drawio-pagebar-drop         —— 拖拽插入位置指示线
 *     button.drawio-pagebar-add       —— + 新建页面
 *     .drawio-pagebar-blank           —— 右侧空白（右键也能弹菜单）
 *
 * 菜单挂在 document.body 上、position: fixed，与画布右键菜单同一套做法，
 * 这样不会被 .drawio-pagebar 的 overflow 裁掉。
 */
export class PageBar {
  private host: PageBarHost;
  private rootEl: HTMLElement;
  private tabsEl: HTMLElement;
  private dropEl: HTMLElement;
  private menuEl: HTMLElement;

  private drag: {
    index: number;
    el: HTMLElement;
    startX: number;
    moved: boolean;
  } | null = null;
  private dragMove: ((e: PointerEvent) => void) | null = null;
  private dragUp: ((e: PointerEvent) => void) | null = null;

  private menuTargetIndex = 0;
  private outsidePointer: ((e: PointerEvent) => void) | null = null;
  private outsideKey: ((e: KeyboardEvent) => void) | null = null;
  private outsideWheel: ((e: Event) => void) | null = null;

  constructor(host: PageBarHost, parent: HTMLElement) {
    this.host = host;

    this.rootEl = parent.createDiv({ cls: "drawio-pagebar" });

    const menuBtn = this.rootEl.createEl("button", {
      // clickable-icon：Obsidian 自己的图标按钮类，能让主题的
      // `button:not(.clickable-icon)` 规则不匹配，避免被画成「灰底实心按钮」
      cls: "clickable-icon drawio-pagebar-menu",
      attr: { title: t("page.menuTip") },
    });
    setSvgMarkup(menuBtn, SVG_MENU);
    menuBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const r = menuBtn.getBoundingClientRect();
      this.openMenu(r.left, r.top, this.host.getActiveIndex());
    });

    this.tabsEl = this.rootEl.createDiv({ cls: "drawio-pagebar-tabs" });

    this.dropEl = this.tabsEl.createDiv({
      cls: "drawio-pagebar-drop drawio-hidden",
    });

    const addBtn = this.rootEl.createEl("button", {
      cls: "clickable-icon drawio-pagebar-add",
      attr: { title: t("page.new") },
    });
    setSvgMarkup(addBtn, SVG_PLUS);
    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.host.addPage();
    });

    const blank = this.rootEl.createDiv({ cls: "drawio-pagebar-blank" });
    blank.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(e.clientX, e.clientY, this.host.getActiveIndex());
    });

    // 菜单一次性建好挂在 body 上，随开随用（显隐走 .drawio-hidden 工具类）
    this.menuEl = document.body.createDiv({
      cls: "drawio-pagebar-menu-list drawio-hidden",
    });
  }

  /** 重建页签（页数 / 名称 / 活动页变化后调用） */
  render(): void {
    const pages = this.host.getPages();
    const active = this.host.getActiveIndex();
    const keepScroll = this.tabsEl.scrollLeft;

    // 只清页签，保留拖拽指示线
    Array.prototype.slice
      .call(this.tabsEl.querySelectorAll(".drawio-pagebar-tab"))
      .forEach((el: HTMLElement) => el.remove());

    pages.forEach((page, index) => {
      const tab = this.tabsEl.createDiv({
        cls:
          "drawio-pagebar-tab" + (index === active ? " is-active" : ""),
      });
      tab.dataset.index = String(index);
      tab.createSpan({ cls: "drawio-pagebar-tab-name", text: page.name });

      if (index === active) {
        const caret = tab.createEl("button", {
          cls: "clickable-icon drawio-pagebar-caret",
          attr: { title: t("page.menuTip") },
        });
        setSvgMarkup(caret, SVG_CARET);
        caret.addEventListener("pointerdown", (e) => e.stopPropagation());
        caret.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const r = caret.getBoundingClientRect();
          this.openMenu(r.right, r.top, index);
        });
      }

      tab.addEventListener("pointerdown", (e) => this.onTabPointerDown(e, index, tab));
      tab.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openMenu(e.clientX, e.clientY, index);
      });
      tab.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startRename(index);
      });
    });

    // 页签数量/宽度变化后，保持滚动位置并让活动页可见
    this.tabsEl.scrollLeft = keepScroll;
    const activeEl = this.tabsEl.querySelector(
      ".drawio-pagebar-tab.is-active"
    ) as HTMLElement | null;
    if (activeEl) {
      const left = activeEl.offsetLeft;
      const right = left + activeEl.offsetWidth;
      if (left < this.tabsEl.scrollLeft) {
        this.tabsEl.scrollLeft = left;
      } else if (right > this.tabsEl.scrollLeft + this.tabsEl.clientWidth) {
        this.tabsEl.scrollLeft = right - this.tabsEl.clientWidth;
      }
    }
  }

  /** 移除 DOM 与全局监听（视图卸载时调用） */
  destroy(): void {
    this.endDrag();
    this.closeMenu();
    if (this.menuEl.parentElement) this.menuEl.remove();
    this.rootEl.remove();
  }

  // ---------------------------------------------------------------- 拖拽重排

  private onTabPointerDown(e: PointerEvent, index: number, tab: HTMLElement): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest(".drawio-pagebar-caret")) return;
    if (target && target.closest("input")) return;

    this.drag = { index, el: tab, startX: e.clientX, moved: false };

    // 不用 setPointerCapture：本构建里捕获会让 pointerup 派生的 click 行为异常
    this.dragMove = (ev: PointerEvent) => this.onDragMove(ev);
    this.dragUp = (ev: PointerEvent) => this.onDragUp(ev);
    document.addEventListener("pointermove", this.dragMove);
    document.addEventListener("pointerup", this.dragUp);
    document.addEventListener("pointercancel", this.dragUp);
  }

  private onDragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      d.el.addClass("is-dragging");
    }
    if (!d.moved) return;

    // 位移是算出来的 → 落成自定义属性，由 .is-dragging 的 var() 消费
    setCssVars(d.el, { "--drawio-tab-dx": `${dx}px` });
    this.placeDropIndicator(this.slotAt(e.clientX));
  }

  private onDragUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.endDrag();
    if (!d.el) return;

    if (d.moved) {
      clearCssVars(d.el, "--drawio-tab-dx");
      d.el.removeClass("is-dragging");
      // slotAt 的坐标系是「抽掉被拖页签后的数组」，正好等价于
      // splice(from,1) 之后要插入的下标，因此不能再做 from/to 补偿
      const to = this.slotAt(e.clientX);
      if (to !== d.index) this.host.movePage(d.index, to);
      else this.render();
    } else {
      this.host.selectPage(d.index);
    }
  }

  private endDrag(): void {
    if (this.dragMove) {
      document.removeEventListener("pointermove", this.dragMove);
      this.dragMove = null;
    }
    if (this.dragUp) {
      document.removeEventListener("pointerup", this.dragUp);
      document.removeEventListener("pointercancel", this.dragUp);
      this.dragUp = null;
    }
    if (this.drag) {
      clearCssVars(this.drag.el, "--drawio-tab-dx");
      this.drag.el.removeClass("is-dragging");
      this.drag = null;
    }
    this.dropEl.classList.add("drawio-hidden");
  }

  /** 非拖拽页签的包围盒（用于计算插入位置） */
  private tabRects(): DOMRect[] {
    return Array.prototype.slice
      .call(this.tabsEl.querySelectorAll(".drawio-pagebar-tab"))
      .filter((el: HTMLElement) => !el.hasClass("is-dragging"))
      .map((el: HTMLElement) => el.getBoundingClientRect());
  }

  /** 光标落在第几个插入位（0 = 最前，length = 最后） */
  private slotAt(clientX: number): number {
    const rects = this.tabRects();
    for (let i = 0; i < rects.length; i++) {
      if (clientX < rects[i].left + rects[i].width / 2) return i;
    }
    return rects.length;
  }

  private placeDropIndicator(slot: number): void {
    const rects = this.tabRects();
    const strip = this.tabsEl.getBoundingClientRect();
    let left: number;
    if (rects.length === 0) left = 0;
    else if (slot >= rects.length) left = rects[rects.length - 1].right - strip.left;
    else left = rects[slot].left - strip.left;

    this.dropEl.style.left = `${left + this.tabsEl.scrollLeft}px`;
    this.dropEl.classList.remove("drawio-hidden");
  }

  // ------------------------------------------------------------------ 重命名

  private startRename(index: number): void {
    const tab = this.tabsEl.querySelector(
      `.drawio-pagebar-tab[data-index="${index}"]`
    ) as HTMLElement | null;
    if (!tab) return;
    const nameEl = tab.querySelector(
      ".drawio-pagebar-tab-name"
    ) as HTMLElement | null;
    if (!nameEl) return;

    const pages = this.host.getPages();
    const current = pages[index] ? pages[index].name : "";

    const input = tab.createEl("input", {
      cls: "drawio-pagebar-rename",
      attr: { type: "text" },
    });
    input.value = current;

    // 输入框宽度随文字长度自适应
    const resize = () => {
      input.style.width = `${Math.max(56, Math.min(200, input.value.length * 8 + 18))}px`;
    };
    resize();
    input.addEventListener("input", resize);

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) {
        const value = input.value.trim();
        if (value && value !== current) this.host.renamePage(index, value);
      }
      this.render();
    };

    // 按键不冒泡出去：否则 Esc 会被 Obsidian 当成关闭面板、Enter 会触发画布快捷键
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("dblclick", (e) => e.stopPropagation());
    input.addEventListener("blur", () => commit(true));
  }

  // -------------------------------------------------------------------- 菜单

  private openMenu(clientX: number, clientY: number, index: number): void {
    const pages = this.host.getPages();
    const count = pages.length;
    const target = Math.max(0, Math.min(index, count - 1));
    this.menuTargetIndex = target;

    this.menuEl.empty();
    const addItem = (
      label: string,
      opts: { disabled?: boolean; danger?: boolean; run: () => void }
    ) => {
      const item = this.menuEl.createDiv({
        cls:
          "drawio-pagebar-menu-item" +
          (opts.disabled ? " is-disabled" : "") +
          (opts.danger ? " is-danger" : ""),
        text: label,
      });
      if (opts.disabled) return;
      item.addEventListener("pointerdown", (e) => e.stopPropagation());
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeMenu();
        opts.run();
      });
    };
    const addSep = () => this.menuEl.createDiv({ cls: "drawio-pagebar-menu-sep" });

    addItem(t("page.rename"), { run: () => this.startRename(target) });
    addItem(t("page.insert"), { run: () => this.host.insertPage(target) });
    addItem(t("page.duplicate"), { run: () => this.host.duplicatePage(target) });
    addSep();
    addItem(t("page.moveLeft"), {
      disabled: target === 0,
      run: () => this.host.movePage(target, target - 1),
    });
    addItem(t("page.moveRight"), {
      disabled: target === count - 1,
      run: () => this.host.movePage(target, target + 1),
    });
    addSep();
    addItem(t("page.delete"), {
      disabled: count <= 1,
      danger: true,
      run: () => this.host.deletePage(target),
    });

    // 量尺寸做视口内钳制
    this.menuEl.classList.remove("drawio-hidden");
    const mw = this.menuEl.offsetWidth;
    const mh = this.menuEl.offsetHeight;
    let x = clientX;
    let y = clientY;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 4;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
    this.menuEl.style.left = `${Math.max(4, x)}px`;
    this.menuEl.style.top = `${Math.max(4, y)}px`;

    this.removeOutsideListeners();
    this.outsidePointer = (ev: PointerEvent) => {
      const node = ev.target as Node | null;
      if (node && this.menuEl.contains(node)) return;
      this.closeMenu();
    };
    this.outsideKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") this.closeMenu();
    };
    this.outsideWheel = () => this.closeMenu();
    document.addEventListener("pointerdown", this.outsidePointer, true);
    document.addEventListener("keydown", this.outsideKey);
    // 页面栏自身滚动或视口尺寸变化后，fixed 定位的菜单会脱节，直接关掉
    window.addEventListener("resize", this.outsideWheel);
    this.tabsEl.addEventListener("scroll", this.outsideWheel, true);
  }

  private removeOutsideListeners(): void {
    if (this.outsidePointer) {
      document.removeEventListener("pointerdown", this.outsidePointer, true);
      this.outsidePointer = null;
    }
    if (this.outsideKey) {
      document.removeEventListener("keydown", this.outsideKey);
      this.outsideKey = null;
    }
    if (this.outsideWheel) {
      window.removeEventListener("resize", this.outsideWheel);
      this.tabsEl.removeEventListener("scroll", this.outsideWheel, true);
      this.outsideWheel = null;
    }
  }

  private closeMenu(): void {
    this.menuEl.classList.add("drawio-hidden");
    this.removeOutsideListeners();
  }
}
