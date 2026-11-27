import { describe, expect, test } from "bun:test";

import { History } from "./history";

describe("History", () => {
  test("steps back and forward through what was recorded", () => {
    const history = new History<string>();
    for (const state of ["a", "b", "c"]) history.record(state);
    expect(history.undo()).toBe("b");
    expect(history.undo()).toBe("a");
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBe("b");
    expect(history.redo()).toBe("c");
    expect(history.redo()).toBeUndefined();
  });

  test("a new state after an undo drops what could be redone", () => {
    const history = new History<string>();
    for (const state of ["a", "b", "c"]) history.record(state);
    history.undo();
    history.record("d");
    expect(history.redo()).toBeUndefined();
    expect(history.undo()).toBe("b");
  });

  test("recording the current state again is not a step", () => {
    const history = new History<string>();
    history.record("a");
    history.record("b");
    history.record("b");
    expect(history.undo()).toBe("a");
    // Restoring "a" makes the editor record it again: still nothing to undo to
    history.record("a");
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBe("b");
  });

  test("forgets the oldest states past its limit", () => {
    const history = new History<number>(3);
    for (let state = 0; state < 10; state++) history.record(state);
    expect(history.undo()).toBe(8);
    expect(history.undo()).toBe(7);
    expect(history.undo()).toBeUndefined();
  });
});
