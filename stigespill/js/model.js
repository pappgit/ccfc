import { paperDimensions } from "./paper.js";

let nextConnectionId = 1;

/**
 * Klassisk stigespill-nummerering: start nederst til venstre, sikksakk oppover.
 * rad 0 (nederst): 1 → cols
 * rad 1: 2*cols → cols+1
 */
export function cellNumber(col, rowFromBottom, cols, rows) {
  const row = rowFromBottom;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  const base = row * cols;
  const even = row % 2 === 0;
  return even ? base + col + 1 : base + (cols - col);
}

export function cellCoords(number, cols, rows) {
  if (number < 1 || number > cols * rows) return null;
  const rowFromBottom = Math.floor((number - 1) / cols);
  const offset = (number - 1) % cols;
  const even = rowFromBottom % 2 === 0;
  const col = even ? offset : cols - 1 - offset;
  return { col, rowFromBottom };
}

export function createBoardState(options = {}) {
  const format = options.format ?? "A4";
  const orientation = options.orientation ?? "portrait";
  const cols = clampInt(options.cols ?? 10, 2, 20);
  const rows = clampInt(options.rows ?? 10, 2, 20);
  const marginMm = options.marginMm ?? 12;

  return {
    paper: paperDimensions(format, orientation),
    grid: { cols, rows },
    marginMm,
    connections: [],
  };
}

export function totalCells(state) {
  return state.grid.cols * state.grid.rows;
}

export function setPaper(state, formatId, orientation) {
  state.paper = paperDimensions(formatId, orientation);
  return state;
}

export function setGrid(state, cols, rows) {
  state.grid.cols = clampInt(cols, 2, 20);
  state.grid.rows = clampInt(rows, 2, 20);
  const max = totalCells(state);
  state.connections = state.connections.filter(
    (c) => c.from <= max && c.to <= max && c.from !== c.to
  );
  return state;
}

export function setMargin(state, marginMm) {
  state.marginMm = Math.max(0, Math.min(40, Number(marginMm) || 0));
  return state;
}

/**
 * Opprett stige (opp) eller slange (ned) mellom to ruter.
 * Retning styres av rutenumrene: høyere tall = opp.
 */
export function addConnection(state, from, to) {
  const max = totalCells(state);
  from = Number(from);
  to = Number(to);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 1 || to < 1 || from > max || to > max || from === to) return null;

  // Én forbindelse per start-/slutt-rute (unngå rot)
  state.connections = state.connections.filter(
    (c) => c.from !== from && c.to !== from && c.from !== to && c.to !== to
  );

  const type = to > from ? "ladder" : "snake";
  const connection = {
    id: `c-${nextConnectionId++}`,
    from,
    to,
    type,
  };
  state.connections.push(connection);
  return connection;
}

export function removeConnection(state, id) {
  const before = state.connections.length;
  state.connections = state.connections.filter((c) => c.id !== id);
  return state.connections.length < before;
}

export function clearConnections(state) {
  state.connections = [];
  return state;
}

export function serialize(state) {
  return JSON.stringify(
    {
      version: 1,
      paper: {
        format: state.paper.formatId,
        orientation: state.paper.orientation,
      },
      grid: { ...state.grid },
      marginMm: state.marginMm,
      connections: state.connections.map(({ from, to, type }) => ({
        from,
        to,
        type,
      })),
    },
    null,
    2
  );
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
