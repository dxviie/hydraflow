/**
 * Undo and redo over whole states. A state is anything that compares with
 * `===`: the editor records the patch as it is saved, as one string.
 */
export class History<State> {
  private past: State[] = [];
  private future: State[] = [];

  constructor(private limit = 200) {}

  /** The state undo would leave, and redo would return to */
  get current(): State | undefined {
    return this.past.at(-1);
  }

  /** Take note of a state. Recording what is already current changes nothing. */
  record(state: State) {
    if (state === this.current) return;
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Step back: the state to restore, or nothing at the beginning */
  undo(): State | undefined {
    if (this.past.length < 2) return undefined;
    this.future.push(this.past.pop() as State);
    return this.current;
  }

  /** Step forward again: the state to restore, or nothing at the end */
  redo(): State | undefined {
    if (this.future.length === 0) return undefined;
    const state = this.future.pop() as State;
    this.past.push(state);
    return state;
  }
}
