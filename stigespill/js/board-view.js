import { cellCoords, cellNumber } from "./model.js";

/**
 * Tegner brettet i et paper-frame og håndterer dra-for-å-koble.
 */
export class BoardView {
  constructor(root, { onChange, onSelectConnection } = {}) {
    this.root = root;
    this.onChange = onChange ?? (() => {});
    this.onSelectConnection = onSelectConnection ?? (() => {});
    this.state = null;
    this.selectedId = null;
    this.drag = null;

    this.paperEl = root.querySelector("[data-paper]");
    this.boardEl = root.querySelector("[data-board]");
    this.svgEl = root.querySelector("[data-paths]");
    this.gridEl = root.querySelector("[data-grid]");
    this.metaEl = root.querySelector("[data-paper-meta]");

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    this.gridEl.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    this.svgEl.addEventListener("pointerdown", (e) => this._onPathPointerDown(e));
  }

  setState(state) {
    this.state = state;
    this.render();
  }

  selectConnection(id) {
    this.selectedId = id;
    this._paintPaths();
    this.onSelectConnection(id);
  }

  render() {
    if (!this.state) return;
    const { paper, grid, marginMm } = this.state;
    const { cols, rows } = grid;

    const ratio = paper.widthMm / paper.heightMm;
    this.paperEl.style.aspectRatio = `${paper.widthMm} / ${paper.heightMm}`;
    this.paperEl.style.setProperty("--paper-ratio", String(ratio));
    this.metaEl.textContent = `${paper.label} · ${paper.widthMm} × ${paper.heightMm} mm · ${
      paper.orientation === "landscape" ? "liggende" : "stående"
    }`;

    // CSS %-padding er alltid ift. bredde — bruk inset i % av papirets sider i stedet
    const insetX = (marginMm / paper.widthMm) * 100;
    const insetY = (marginMm / paper.heightMm) * 100;
    this.boardEl.style.left = `${insetX}%`;
    this.boardEl.style.right = `${insetX}%`;
    this.boardEl.style.top = `${insetY}%`;
    this.boardEl.style.bottom = `${insetY}%`;

    this.gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.gridEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    this.gridEl.replaceChildren();

    // CSS grid fylles topp→bunn; vi mapper radFromTop → rowFromBottom
    for (let rowFromTop = 0; rowFromTop < rows; rowFromTop++) {
      const rowFromBottom = rows - 1 - rowFromTop;
      for (let col = 0; col < cols; col++) {
        const number = cellNumber(col, rowFromBottom, cols, rows);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.dataset.number = String(number);
        cell.setAttribute("aria-label", `Rute ${number}`);

        const label = document.createElement("span");
        label.className = "cell__num";
        label.textContent = String(number);
        cell.appendChild(label);

        if (number === 1) cell.classList.add("cell--start");
        if (number === cols * rows) cell.classList.add("cell--finish");

        this.gridEl.appendChild(cell);
      }
    }

    this._paintPaths();
    this._paintEndpoints();
  }

  _paintEndpoints() {
    this.gridEl.querySelectorAll(".cell").forEach((el) => {
      el.classList.remove("cell--ladder-from", "cell--ladder-to", "cell--snake-from", "cell--snake-to");
    });
    for (const c of this.state.connections) {
      const fromEl = this.gridEl.querySelector(`[data-number="${c.from}"]`);
      const toEl = this.gridEl.querySelector(`[data-number="${c.to}"]`);
      if (fromEl) fromEl.classList.add(c.type === "ladder" ? "cell--ladder-from" : "cell--snake-from");
      if (toEl) toEl.classList.add(c.type === "ladder" ? "cell--ladder-to" : "cell--snake-to");
    }
  }

  _cellCenter(number) {
    const { cols, rows } = this.state.grid;
    const coords = cellCoords(number, cols, rows);
    if (!coords) return null;
    const rowFromTop = rows - 1 - coords.rowFromBottom;
    // SVG er 0–100 i begge akser over grid-området
    const x = ((coords.col + 0.5) / cols) * 100;
    const y = ((rowFromTop + 0.5) / rows) * 100;
    return { x, y };
  }

  _pathD(from, to, type) {
    const a = this._cellCenter(from);
    const b = this._cellCenter(to);
    if (!a || !b) return "";
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Lett kurve for lesbarhet
    const bend = type === "snake" ? 12 : 8;
    const mx = (a.x + b.x) / 2 + (dy === 0 ? bend : 0);
    const my = (a.y + b.y) / 2 + (dx === 0 ? 0 : type === "snake" ? bend * Math.sign(dx || 1) * 0.4 : -bend * 0.25);
    // Perpendikulær offset
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * bend;
    const oy = (dx / len) * bend;
    const cx = (a.x + b.x) / 2 + ox * (type === "snake" ? 1 : 0.55);
    const cy = (a.y + b.y) / 2 + oy * (type === "snake" ? 1 : 0.55);
    return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
  }

  _paintPaths(preview = null) {
    const ns = "http://www.w3.org/2000/svg";
    this.svgEl.replaceChildren();
    this.svgEl.setAttribute("viewBox", "0 0 100 100");

    for (const c of this.state.connections) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", this._pathD(c.from, c.to, c.type));
      path.setAttribute("class", `path path--${c.type}${c.id === this.selectedId ? " path--selected" : ""}`);
      path.dataset.id = c.id;
      path.setAttribute("fill", "none");
      this.svgEl.appendChild(path);

      // Marker ved endepunkt
      const end = this._cellCenter(c.to);
      if (end) {
        const mark = document.createElementNS(ns, "circle");
        mark.setAttribute("cx", end.x);
        mark.setAttribute("cy", end.y);
        mark.setAttribute("r", "1.6");
        mark.setAttribute("class", `path-end path-end--${c.type}`);
        mark.dataset.id = c.id;
        this.svgEl.appendChild(mark);
      }
    }

    if (preview) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", this._pathD(preview.from, preview.to, preview.type));
      path.setAttribute("class", `path path--${preview.type} path--preview`);
      path.setAttribute("fill", "none");
      this.svgEl.appendChild(path);
    }
  }

  _onPointerDown(e) {
    const cell = e.target.closest(".cell");
    if (!cell || !this.state) return;
    e.preventDefault();
    this.selectConnection(null);
    const from = Number(cell.dataset.number);
    this.drag = { from, pointerId: e.pointerId };
    cell.classList.add("cell--dragging");
    cell.setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
  }

  _onPointerMove(e) {
    if (!this.drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest?.(".cell");
    this.gridEl.querySelectorAll(".cell--drop-target").forEach((c) => c.classList.remove("cell--drop-target"));
    if (!cell) {
      this._paintPaths();
      return;
    }
    const to = Number(cell.dataset.number);
    if (to === this.drag.from) {
      this._paintPaths();
      return;
    }
    cell.classList.add("cell--drop-target");
    const type = to > this.drag.from ? "ladder" : "snake";
    this._paintPaths({ from: this.drag.from, to, type });
  }

  _onPointerUp(e) {
    if (!this.drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest?.(".cell");
    const from = this.drag.from;
    this.gridEl.querySelectorAll(".cell--dragging, .cell--drop-target").forEach((c) => {
      c.classList.remove("cell--dragging", "cell--drop-target");
    });
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerUp);
    this.drag = null;

    if (cell) {
      const to = Number(cell.dataset.number);
      if (to !== from) {
        this.onChange({ type: "add-connection", from, to });
        return;
      }
    }
    this._paintPaths();
  }

  _onPathPointerDown(e) {
    const target = e.target.closest("[data-id]");
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    this.selectConnection(target.dataset.id);
  }
}
