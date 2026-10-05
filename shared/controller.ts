import type { TurnClassifier } from "./classifier.js";
import { LoopGuard, type LoopGuardState, type ProgressSnapshot } from "./safety.js";
import type { ControllerAction, ControllerConfig, TurnClassificationInput, TurnState } from "./types.js";

export interface ControllerEvent { type: "STATE_EVALUATED" | "AUTO_CONTINUE_REQUESTED" | "VERIFY_REQUESTED" | "NEXT_TODO_REQUESTED" | "USER_INPUT_REQUIRED" | "DECISION_REQUIRED" | "TASK_COMPLETED" | "LOOP_GUARD_TRIPPED"; state?: TurnState; confidence?: number; reason?: string; }
export type EventSink = (event: ControllerEvent) => void;

export interface ControllerRuntime { snapshot: ProgressSnapshot; continueAgent(prompt: string): Promise<void>; }

export const prompts = {
  CONTINUE: "Continue the current task. Do not stop merely to report progress. Complete the current work unless genuinely blocked.",
  VERIFY_DONE: "Verify that the task is actually complete. Check the requirements, tests, repository state, remaining todos, and required deliverables. Finish anything missing before stopping.",
  NEXT_TODO: "Continue with the next appropriate unresolved item from the existing plan. Preserve the current task context and ordering constraints."
} as const;

export class ContinuationController {
  private readonly guard: LoopGuard;
  private readonly autoActConfidence: number;
  constructor(private readonly classifier: TurnClassifier, config: Partial<ControllerConfig> = {}, private readonly emit: EventSink = () => {}, initialGuardState?: LoopGuardState) {
    this.autoActConfidence = config.auto_act_confidence ?? 0.8;
    this.guard = new LoopGuard({ max_auto_turns: 12, max_repeated_state: 3, max_identical_blocker_repeats: 2, auto_act_confidence: 0.8, escalate_below: 0.55, ...config }, initialGuardState);
  }

  guardState(): LoopGuardState {
    return this.guard.snapshot();
  }

  async evaluate(input: TurnClassificationInput, runtime: ControllerRuntime): Promise<ControllerAction> {
    const classification = await this.classifier.classify(input);
    this.emit({ type: "STATE_EVALUATED", state: classification.state, confidence: classification.confidence, reason: classification.reason });
    const automaticState = classification.state === "CONTINUE" || classification.state === "VERIFY_DONE" || classification.state === "NEXT_TODO" || classification.state === "NEEDS_DECISION";
    if (automaticState && classification.confidence < this.autoActConfidence) {
      const reason = `Low-confidence classification (${classification.confidence.toFixed(2)}); automatic action requires ${this.autoActConfidence.toFixed(2)}`;
      this.emit({ type: "USER_INPUT_REQUIRED", state: "NEEDS_USER", confidence: classification.confidence, reason });
      return { state: "NEEDS_USER", confidence: classification.confidence, reason };
    }
    const guardReason = classification.state === "DONE" || classification.state === "NEEDS_USER" ? undefined : this.guard.record(classification, runtime.snapshot);
    if (guardReason) {
      this.emit({ type: "LOOP_GUARD_TRIPPED", reason: guardReason });
      return { state: "NEEDS_USER", confidence: 1, reason: guardReason };
    }
    if (classification.state === "DONE") { this.emit({ type: "TASK_COMPLETED", state: "DONE", confidence: classification.confidence, reason: classification.reason }); return { ...classification, reason: classification.reason ?? "Task complete" }; }
    if (classification.state === "NEEDS_USER" || classification.state === "NEEDS_DECISION") { this.emit({ type: classification.state === "NEEDS_USER" ? "USER_INPUT_REQUIRED" : "DECISION_REQUIRED", state: classification.state, confidence: classification.confidence, reason: classification.reason }); return { ...classification, reason: classification.reason ?? `Controller requires ${classification.state}` };
    }
    const prompt = prompts[classification.state];
    this.emit({ type: classification.state === "CONTINUE" ? "AUTO_CONTINUE_REQUESTED" : classification.state === "VERIFY_DONE" ? "VERIFY_REQUESTED" : "NEXT_TODO_REQUESTED", state: classification.state, confidence: classification.confidence, reason: classification.reason });
    await runtime.continueAgent(prompt);
    return { ...classification, prompt, reason: classification.reason ?? `Requested ${classification.state}` };
  }
}
