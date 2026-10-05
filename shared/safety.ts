import type { ControllerConfig, TurnClassification, TurnState } from "./types.js";

export interface ProgressSnapshot {
  todos: string;
  files: string;
  tests: string;
  commit: string;
  mr: string;
  blocker: string;
  action: string;
}

export interface LoopGuardState {
  turns: number;
  states: Partial<Record<TurnState, number>>;
  blockers: Record<string, number>;
  previousFingerprint?: string;
  stagnantTurns: number;
}

export class LoopGuard {
  private turns = 0;
  private readonly states = new Map<TurnState, number>();
  private readonly blockers = new Map<string, number>();
  private previousFingerprint: string | undefined;
  private stagnantTurns = 0;

  constructor(private readonly config: ControllerConfig, initial?: LoopGuardState) {
    if (!initial) return;
    this.turns = initial.turns;
    for (const [state, count] of Object.entries(initial.states)) if (count !== undefined) this.states.set(state as TurnState, count);
    for (const [blocker, count] of Object.entries(initial.blockers)) this.blockers.set(blocker, count);
    this.previousFingerprint = initial.previousFingerprint;
    this.stagnantTurns = initial.stagnantTurns;
  }

  snapshot(): LoopGuardState {
    return {
      turns: this.turns,
      states: Object.fromEntries(this.states),
      blockers: Object.fromEntries(this.blockers),
      previousFingerprint: this.previousFingerprint,
      stagnantTurns: this.stagnantTurns,
    };
  }

  record(classification: TurnClassification, snapshot: ProgressSnapshot): string | undefined {
    this.turns++;
    if (this.turns > this.config.max_auto_turns) return "Maximum automatic turns exceeded";
    const stateCount = (this.states.get(classification.state) ?? 0) + 1;
    this.states.set(classification.state, stateCount);
    if (stateCount > this.config.max_repeated_state) return `State ${classification.state} repeated too many times`;
    const blocker = snapshot.blocker.trim();
    if (blocker) {
      const count = (this.blockers.get(blocker) ?? 0) + 1;
      this.blockers.set(blocker, count);
      if (count > this.config.max_identical_blocker_repeats) return "The same blocker repeated too many times";
    }
    const fingerprint = JSON.stringify(snapshot);
    this.stagnantTurns = fingerprint === this.previousFingerprint ? this.stagnantTurns + 1 : 0;
    this.previousFingerprint = fingerprint;
    if (this.stagnantTurns >= this.config.max_repeated_state) return "No measurable task progress detected";
    return undefined;
  }
}
