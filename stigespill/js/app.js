import {
  addConnection,
  clearConnections,
  createBoardState,
  removeConnection,
  serialize,
  setGrid,
  setMargin,
  setPaper,
  totalCells,
} from "./model.js";
import { PAPER_FORMATS } from "./paper.js";
import { BoardView } from "./board-view.js";

const state = createBoardState({ format: "A4", orientation: "portrait", cols: 10, rows: 10 });

const els = {
  format: document.querySelector("#format"),
  orientation: document.querySelector("#orientation"),
  cols: document.querySelector("#cols"),
  rows: document.querySelector("#rows"),
  margin: document.querySelector("#margin"),
  clear: document.querySelector("#clear-connections"),
  deleteConn: document.querySelector("#delete-connection"),
  exportJson: document.querySelector("#export-json"),
  print: document.querySelector("#print"),
  status: document.querySelector("#status"),
  connectionList: document.querySelector("#connection-list"),
  cellCount: document.querySelector("#cell-count"),
};

const view = new BoardView(document.querySelector("[data-workspace]"), {
  onChange(action) {
    if (action.type === "add-connection") {
      const conn = addConnection(state, action.from, action.to);
      if (conn) {
        setStatus(
          conn.type === "ladder"
            ? `Stige: ${conn.from} → ${conn.to}`
            : `Slange: ${conn.from} → ${conn.to}`
        );
        view.selectConnection(conn.id);
      } else {
        setStatus("Ugyldig forbindelse");
      }
      refresh();
    }
  },
  onSelectConnection(id) {
    els.deleteConn.disabled = !id;
    highlightListItem(id);
  },
});

function setStatus(text) {
  els.status.textContent = text;
}

function refresh() {
  view.setState(state);
  els.cols.value = String(state.grid.cols);
  els.rows.value = String(state.grid.rows);
  els.margin.value = String(state.marginMm);
  els.format.value = state.paper.formatId;
  els.orientation.value = state.paper.orientation;
  els.cellCount.textContent = String(totalCells(state));
  renderConnectionList();
  els.deleteConn.disabled = !view.selectedId;
}

function renderConnectionList() {
  els.connectionList.replaceChildren();
  if (state.connections.length === 0) {
    const empty = document.createElement("li");
    empty.className = "conn-list__empty";
    empty.textContent = "Ingen stiger eller slanger ennå. Dra fra én rute til en annen.";
    els.connectionList.appendChild(empty);
    return;
  }

  const sorted = [...state.connections].sort((a, b) => a.from - b.from);
  for (const c of sorted) {
    const li = document.createElement("li");
    li.className = `conn-list__item conn-list__item--${c.type}`;
    li.dataset.id = c.id;
    if (c.id === view.selectedId) li.classList.add("is-selected");

    const kind = document.createElement("span");
    kind.className = "conn-list__kind";
    kind.textContent = c.type === "ladder" ? "Stige" : "Slange";

    const route = document.createElement("span");
    route.className = "conn-list__route";
    route.textContent = `${c.from} → ${c.to}`;

    li.append(kind, route);
    li.addEventListener("click", () => {
      view.selectConnection(c.id);
      highlightListItem(c.id);
      els.deleteConn.disabled = false;
    });
    els.connectionList.appendChild(li);
  }
}

function highlightListItem(id) {
  els.connectionList.querySelectorAll(".conn-list__item").forEach((el) => {
    el.classList.toggle("is-selected", el.dataset.id === id);
  });
}

// Fyll format-select
for (const fmt of Object.values(PAPER_FORMATS)) {
  const opt = document.createElement("option");
  opt.value = fmt.id;
  opt.textContent = `${fmt.label} (${fmt.widthMm}×${fmt.heightMm} mm)`;
  els.format.appendChild(opt);
}

els.format.addEventListener("change", () => {
  setPaper(state, els.format.value, els.orientation.value);
  setStatus(`Papir: ${state.paper.label}`);
  refresh();
});

els.orientation.addEventListener("change", () => {
  setPaper(state, els.format.value, els.orientation.value);
  refresh();
});

function applyGrid() {
  setGrid(state, els.cols.value, els.rows.value);
  setStatus(`Brett: ${state.grid.cols} × ${state.grid.rows}`);
  refresh();
}

els.cols.addEventListener("change", applyGrid);
els.rows.addEventListener("change", applyGrid);

els.margin.addEventListener("change", () => {
  setMargin(state, els.margin.value);
  refresh();
});

els.clear.addEventListener("click", () => {
  clearConnections(state);
  view.selectConnection(null);
  setStatus("Alle forbindelser fjernet");
  refresh();
});

els.deleteConn.addEventListener("click", () => {
  if (!view.selectedId) return;
  removeConnection(state, view.selectedId);
  view.selectConnection(null);
  setStatus("Forbindelse slettet");
  refresh();
});

els.exportJson.addEventListener("click", () => {
  const blob = new Blob([serialize(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stigespill-${state.paper.formatId.toLowerCase()}-${state.grid.cols}x${state.grid.rows}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("JSON lastet ned (utkast til trykkfil-pipeline)");
});

els.print.addEventListener("click", () => {
  window.print();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    if (view.selectedId && !isFormField(e.target)) {
      e.preventDefault();
      removeConnection(state, view.selectedId);
      view.selectConnection(null);
      setStatus("Forbindelse slettet");
      refresh();
    }
  }
});

function isFormField(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
}

setStatus("Dra fra en rute til en annen for å lage stige (opp) eller slange (ned)");
refresh();
