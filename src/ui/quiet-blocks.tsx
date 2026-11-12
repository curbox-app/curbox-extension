import { useEffect, useRef } from "react";
import {
  BOARD_SIZE,
  SHAPES,
  TRAY_SLOTS,
  fits,
  newGame,
  place,
  shapeHeight,
  shapeWidth,
  type QuietBlocksState,
  type Shape,
} from "../lib/quiet-blocks";

const FADE_MS = 350;
const COLOR_VARS = ["--primary", "--accent", "--muted"];

interface Drag {
  slot: number;
  x: number;
  y: number;
  ghost: [number, number] | null;
}

// Draws the board on a canvas the way Android QuietBlocksView does: a square
// board with the tray below it, and the dragged piece floating above the finger.
export function QuietBlocks({ frozen }: { frozen: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const style = getComputedStyle(canvas);
    const empty = style.getPropertyValue("--card").trim();
    const colors = ["", ...COLOR_VARS.map((name) => style.getPropertyValue(name).trim())];

    let game: QuietBlocksState = newGame();
    let drag: Drag | null = null;
    let fading = new Map<number, number>();
    let fadeStart = 0;
    let frame = 0;
    let width = 0;
    let height = 0;
    let cell = 0;
    let boardLeft = 0;
    let trayTop = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const boardSize = Math.min(width, height / 1.5);
      cell = boardSize / BOARD_SIZE;
      boardLeft = (width - boardSize) / 2;
      trayTop = boardSize + cell;
      draw();
    };

    const square = (left: number, top: number, size: number, color: string, alpha = 1) => {
      const gap = size * 0.08;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(left + gap, top + gap, size - gap * 2, size - gap * 2, size * 0.18);
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    const drawShape = (shape: Shape, left: number, top: number, size: number, color: string, alpha = 1) => {
      for (const [r, c] of shape) square(left + c * size, top + r * size, size, color, alpha);
    };

    const slotCenter = (slot: number): [number, number] => {
      const slotWidth = width / TRAY_SLOTS;
      return [slotWidth * slot + slotWidth / 2, trayTop + (height - trayTop) / 2];
    };

    const dragTopLeft = (shape: Shape, x: number, y: number): [number, number] => [
      x - (shapeWidth(shape) * cell) / 2,
      y - shapeHeight(shape) * cell - cell * 1.2,
    ];

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const fade = fading.size > 0 ? Math.max(0, 1 - (performance.now() - fadeStart) / FADE_MS) : 0;
      game.board.forEach((color, index) => {
        const left = boardLeft + (index % BOARD_SIZE) * cell;
        const top = Math.floor(index / BOARD_SIZE) * cell;
        if (color) return square(left, top, cell, colors[color]);
        square(left, top, cell, empty);
        const faded = fading.get(index);
        if (fade > 0 && faded) square(left, top, cell, colors[faded], fade);
      });
      if (drag?.ghost) {
        const [row, col] = drag.ghost;
        drawShape(SHAPES[game.tray[drag.slot]], boardLeft + col * cell, row * cell, cell, colors[game.trayColors[drag.slot]], 0.35);
      }
      const trayCell = cell * 0.55;
      game.tray.forEach((shapeIndex, slot) => {
        if (shapeIndex < 0 || slot === drag?.slot) return;
        const shape = SHAPES[shapeIndex];
        const [cx, cy] = slotCenter(slot);
        const left = cx - (shapeWidth(shape) * trayCell) / 2;
        const top = cy - (shapeHeight(shape) * trayCell) / 2;
        drawShape(shape, left, top, trayCell, colors[game.trayColors[slot]]);
      });
      if (drag) {
        const shape = SHAPES[game.tray[drag.slot]];
        const [left, top] = dragTopLeft(shape, drag.x, drag.y);
        drawShape(shape, left, top, cell, colors[game.trayColors[drag.slot]]);
      }
      if (fade > 0) frame = requestAnimationFrame(draw);
      else fading = new Map();
    };

    const point = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    const updateGhost = (current: Drag) => {
      const shape = SHAPES[game.tray[current.slot]];
      const [left, top] = dragTopLeft(shape, current.x, current.y);
      const col = Math.round((left - boardLeft) / cell);
      const row = Math.round(top / cell);
      current.ghost = fits(game.board, shape, row, col) ? [row, col] : null;
    };

    const onDown = (event: PointerEvent) => {
      if (frozenRef.current) return;
      const [x, y] = point(event);
      if (y < trayTop - cell) return;
      const slot = Math.min(TRAY_SLOTS - 1, Math.max(0, Math.floor(x / (width / TRAY_SLOTS))));
      if (game.tray[slot] < 0) return;
      canvas.setPointerCapture(event.pointerId);
      drag = { slot, x, y, ghost: null };
      updateGhost(drag);
      draw();
    };

    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      [drag.x, drag.y] = point(event);
      updateGhost(drag);
      draw();
    };

    const onUp = () => {
      if (!drag) return;
      const result = drag.ghost && !frozenRef.current ? place(game, drag.slot, drag.ghost[0], drag.ghost[1]) : null;
      drag = null;
      if (result) {
        game = result.state;
        if (result.cleared.size > 0) {
          fading = result.cleared;
          fadeStart = performance.now();
        }
      }
      cancelAnimationFrame(frame);
      draw();
    };

    const onCancel = () => {
      drag = null;
      draw();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Play a calm puzzle"
      className="aspect-[2/3] w-full max-w-[360px] touch-none select-none"
    />
  );
}
