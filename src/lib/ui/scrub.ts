/**
 * Drag sideways on an element to change a number: the way every value in the
 * editor is set. Shift slows it down for fine work.
 */
import type { Action } from "svelte/action";

export interface ScrubOptions {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onchange: (value: number) => void;
}

/** How far the pointer moves before a press counts as a drag, in px */
const SLOP = 3;
/** A full sweep of the range takes at least this many px, however narrow the element */
const MIN_TRAVEL = 160;

export function snap(value: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return Number(snapped.toFixed(6));
}

export const scrub: Action<HTMLElement, ScrubOptions> = (node, initial) => {
  let options = initial;
  let startX = 0;
  let startValue = 0;
  let dragging = false;
  let pointer: number | undefined;

  const onPointerDown = (event: PointerEvent) => {
    if (options.disabled || event.button !== 0) return;
    // A press on a button, a field or a socket is for that, not for the number
    if ((event.target as HTMLElement).closest("button, input, .svelte-flow__handle")) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startValue = options.value;
    dragging = false;
    node.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    const moved = event.clientX - startX;
    if (!dragging && Math.abs(moved) < SLOP) return;
    dragging = true;
    const { min, max, step } = options;
    const travel = Math.max(node.clientWidth, MIN_TRAVEL);
    const delta = (moved / travel) * (max - min) * (event.shiftKey ? 0.1 : 1);
    // A typed value can sit outside the range: scrubbing doesn't yank it back in
    const low = Math.min(min, startValue);
    const high = Math.max(max, startValue);
    const next = Math.min(high, Math.max(low, snap(startValue + delta, step)));
    if (next !== options.value) options.onchange(next);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = undefined;
    node.releasePointerCapture(event.pointerId);
  };

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerUp);

  return {
    update(next) {
      options = next;
    },
    destroy() {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
    },
  };
};
