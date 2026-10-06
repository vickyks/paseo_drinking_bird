import type { ControllerConfig, TurnClassification } from "./types.js";

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
  lastState?: string;
  consecutiveStateCount: number;
  blockers: Record<string, number>;
  previousFingerprint?: string;
  stagnantTurns: number;
  recenterAttempts: number;
}

export interface GuardTrip {
  reason: string;
  /** True when the trip indicates stagnation and a recenter may recover it. */
  stagnation: boolean;
}

export class LoopGuard {
  private turns = 0;
  private lastState: string | undefined;
  private consecutiveStateCount = 0;
  private readonly blockers = new Map<string, number>();
  private previousFingerprint: string | undefined;
  private stagnantTurns = 0;
  private recenterAttempts = 0;

  constructor(private readonly config: ControllerConfig, initial?: LoopGuardState) {
    if (!initial) return;
    this.turns = initial.turns;
    this.recenterAttempts = initial.recenterAttempts;
    this.lastState = initial.lastState;
    this.consecutiveStateCount = initial.consecutiveStateCount ?? 0;
    for (const [blocker, count] of Object.entries(initial.blockers)) this.blockers.set(blocker, count);
    this.previousFingerprint = initial.previousFingerprint;
    this.stagnantTurns = initial.stagnantTurns;
  }

  snapshot(): LoopGuardState {
    return {
      turns: this.turns,
      lastState: this.lastState,
      consecutiveStateCount: this.consecutiveStateCount,
      blockers: Object.fromEntries(this.blockers),
      previousFingerprint: this.previousFingerprint,
      stagnantTurns: this.stagnantTurns,
      recenterAttempts: this.recenterAttempts,
    };
  }

  turnsUsed(): number {
    return this.turns;
  }

  markRecenter(): void {
    this.recenterAttempts++;
    this.resetStagnation();
  }

  resetStagnation(): void {
    this.stagnantTurns = 0;
    this.blockers.clear();
  }

  record(classification: TurnClassification, snapshot: ProgressSnapshot): GuardTrip | undefined {
    this.turns++;
    if (this.turns > this.config.max_auto_turns) return { reason: "Maximum automatic turns exceeded", stagnation: false };
    if (this.lastState === classification.state) this.consecutiveStateCount++;
    else { this.lastState = classification.state; this.consecutiveStateCount = 1; }
    if (this.consecutiveStateCount > this.config.max_repeated_state) return { reason: `State ${classification.state} repeated too many consecutive times`, stagnation: false };
    const blocker = snapshot.blocker.trim();
    if (blocker) {
      const count = (this.blockers.get(blocker) ?? 0) + 1;
      this.blockers.set(blocker, count);
      if (count > this.config.max_identical_blocker_repeats) return { reason: "The same blocker repeated too many times", stagnation: true };
    }
    const fingerprint = JSON.stringify(snapshot);
    this.stagnantTurns = fingerprint === this.previousFingerprint ? this.stagnantTurns + 1 : 0;
    this.previousFingerprint = fingerprint;
    if (this.stagnantTurns >= this.config.max_repeated_state) return { reason: "No measurable task progress detected", stagnation: true };
    return undefined;
  }
}