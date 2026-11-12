import { describe, expect, it } from "vitest";
import { BOARD_SIZE, newGame, place, type QuietBlocksState } from "./quiet-blocks";

const fixed = () => 0;

function state(board: number[], tray: number[]): QuietBlocksState {
  return { board, tray, trayColors: tray.map(() => 1) };
}

describe("quiet blocks", () => {
  it("places a piece and rejects one that does not fit", () => {
    const game = newGame(fixed);
    const placed = place(state(game.board, [0, 0, 0]), 0, 2, 3, fixed)!;
    expect(placed.state.board[2 * BOARD_SIZE + 3]).toBe(1);
    expect(placed.state.tray[0]).toBe(-1);
    expect(place(placed.state, 1, 2, 3, fixed)).toBeNull();
    expect(place(placed.state, 0, 0, 0, fixed)).toBeNull();
  });

  it("clears a full row and deals a new tray once all pieces are used", () => {
    const board = Array(BOARD_SIZE * BOARD_SIZE).fill(0);
    for (let c = 0; c < BOARD_SIZE - 1; c++) board[c] = 2;
    const result = place(state(board, [0, -1, -1]), 0, 0, BOARD_SIZE - 1, fixed)!;
    expect(result.cleared.size).toBe(BOARD_SIZE);
    expect(result.state.board.every((cell) => cell === 0)).toBe(true);
    expect(result.state.tray).toEqual([0, 0, 0]);
  });

  it("clears the board when nothing in the tray fits", () => {
    const board = Array(BOARD_SIZE * BOARD_SIZE).fill(0);
    for (let i = 0; i < board.length; i++) if ((Math.floor(i / BOARD_SIZE) + (i % BOARD_SIZE)) % 2 === 0) board[i] = 3;
    board[1] = 3;
    const square = 9;
    const result = place(state(board, [0, square, -1]), 0, 0, 3, fixed)!;
    expect(result.state.board.every((cell) => cell === 0)).toBe(true);
    expect(result.cleared.size).toBeGreaterThan(0);
  });
});
