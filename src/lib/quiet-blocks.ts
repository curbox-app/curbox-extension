// The calm block placing puzzle from Android QuietBlocksView. Pieces from the
// tray go onto the board, full rows and columns clear, and there is no score
// and no game over: when nothing fits, the board clears and play goes on.

export const BOARD_SIZE = 8;
export const TRAY_SLOTS = 3;
export const COLOR_COUNT = 3;

/** Each piece is a list of [row, column] cells. */
export const SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 0]],
  [[0, 0], [0, 1], [1, 1]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [0, 3]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
];

export type Shape = (typeof SHAPES)[number];

export const shapeWidth = (shape: Shape) => Math.max(...shape.map(([, c]) => c)) + 1;
export const shapeHeight = (shape: Shape) => Math.max(...shape.map(([r]) => r)) + 1;

export interface QuietBlocksState {
  /** 0 is empty, otherwise a color from 1 to COLOR_COUNT. */
  board: number[];
  /** Shape index per slot, -1 once placed. */
  tray: number[];
  trayColors: number[];
}

export interface PlaceResult {
  state: QuietBlocksState;
  /** Cells that cleared, with the color each had, so they can fade out. */
  cleared: Map<number, number>;
}

const randomInt = (max: number, random: () => number) => Math.floor(random() * max);

export function dealTray(random: () => number = Math.random): Pick<QuietBlocksState, "tray" | "trayColors"> {
  return {
    tray: Array.from({ length: TRAY_SLOTS }, () => randomInt(SHAPES.length, random)),
    trayColors: Array.from({ length: TRAY_SLOTS }, () => 1 + randomInt(COLOR_COUNT, random)),
  };
}

export function newGame(random: () => number = Math.random): QuietBlocksState {
  return { board: Array(BOARD_SIZE * BOARD_SIZE).fill(0), ...dealTray(random) };
}

export function fits(board: number[], shape: Shape, row: number, col: number): boolean {
  return shape.every(([dr, dc]) => {
    const r = row + dr;
    const c = col + dc;
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r * BOARD_SIZE + c] === 0;
  });
}

function fitsAnywhere(board: number[], shape: Shape): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) if (fits(board, shape, row, col)) return true;
  }
  return false;
}

function fullLines(board: number[]): Set<number> {
  const cells = new Set<number>();
  const line = (index: (i: number) => number) => {
    const indices = Array.from({ length: BOARD_SIZE }, (_, i) => index(i));
    if (indices.every((i) => board[i] !== 0)) indices.forEach((i) => cells.add(i));
  };
  for (let n = 0; n < BOARD_SIZE; n++) {
    line((i) => n * BOARD_SIZE + i);
    line((i) => i * BOARD_SIZE + n);
  }
  return cells;
}

export function place(
  state: QuietBlocksState,
  slot: number,
  row: number,
  col: number,
  random: () => number = Math.random,
): PlaceResult | null {
  const shape = SHAPES[state.tray[slot]];
  if (!shape || !fits(state.board, shape, row, col)) return null;
  const board = [...state.board];
  for (const [dr, dc] of shape) board[(row + dr) * BOARD_SIZE + col + dc] = state.trayColors[slot];
  let tray = state.tray.map((shapeIndex, i) => (i === slot ? -1 : shapeIndex));
  let trayColors = state.trayColors;

  const cleared = new Map<number, number>();
  const clear = (cells: Iterable<number>) => {
    for (const i of cells) {
      if (board[i] === 0) continue;
      cleared.set(i, board[i]);
      board[i] = 0;
    }
  };
  clear(fullLines(board));
  if (tray.every((shapeIndex) => shapeIndex < 0)) ({ tray, trayColors } = dealTray(random));
  if (!tray.some((shapeIndex) => shapeIndex >= 0 && fitsAnywhere(board, SHAPES[shapeIndex]))) {
    clear(board.keys());
    ({ tray, trayColors } = dealTray(random));
  }
  return { state: { board, tray, trayColors }, cleared };
}
