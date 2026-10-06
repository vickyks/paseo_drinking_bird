import type { ClassifierConfig, DeciderAssessment, DeciderAction, DeciderDecision, TurnClassification, TurnClassificationInput, TurnKind, TaskState, TurnState } from "./types.js";

/**
 * The decider (JEV) sees facts and transcripts, never opinions. It classifies;
 * it never writes prompts — the controller instantiates those.
 */
export const DECIDER_SYSTEM_PROMPT = `You are a controller classifier for an autonomous coding agent. You do not write code and you do not talk to the user.
Classify the agent turn you are given. Output ONLY a single JSON object matching this exact schema:
{"assessment":{"turn_kind":"controller_turn|task_turn|question_turn|interrupt_turn","task_state":"in_progress|complete_unverified|complete_evidenced|blocked_user|blocked_agent_decision|stagnating","evidence":[{"type":"...","summary":"..."}],"reason":"one or two sentences"},"action":{"decision":"DONE|CONTINUE|VERIFY_DONE|NEXT_TODO|NEEDS_DECISION|NEEDS_USER|RECENTER|WAIT_FOR_USER","confidence":0.0,"auto_executable":true}}

Calibration rules:
- "complete_evidenced" requires listed runtime evidence (tests passed, clean plan). Prose claims of completion ("I have finished", "the task is complete") are NOT evidence.
- If completion is claimed but evidence is insufficient, use "complete_unverified" and decision VERIFY_DONE. Never invent progress.
- If the last user message is a question, an information pull ("tell me", "show me", "give me") or a challenge ("why did you..."), turn_kind is "question_turn" and the only legal decision is WAIT_FOR_USER.
- If the last user message is a stop, a constraint or a course correction ("wait", "don't touch X"), turn_kind is "interrupt_turn" and the only legal decision is WAIT_FOR_USER.
- If the user supplied new evidence after a failure ("still failing: <...>", pasted output), the turn is legally continuable: use task_state "in_progress" and raise your confidence; the evidence itself is progress toward a retry.
- If the turn shows repeated states, repeated identical blockers, or unchanged runtime evidence across turns, task_state is "stagnating" and decision RECENTER.
- NEEDS_USER only when the agent explicitly requests human input, a credential, or a decision it is not authorised to make.
- NEEDS_DECISION for technical/architectural choices that can be delegated to a reviewer agent.
- confidence < 0.8 REQUIRES auto_executable false.
`;

export function deciderSystemPrompt(config: Pick<ClassifierConfig, "decider_prompt"> = {}): string {
  return config.decider_prompt ?? DECIDER_SYSTEM_PROMPT;
}

export function buildDeciderPayload(input: TurnClassificationInput, config: Pick<ClassifierConfig, "decider_prompt"> = {}): { system: string; input: TurnClassificationInput } {
  return { system: deciderSystemPrompt(config), input };
}

const TURN_KINDS: ReadonlySet<TurnKind> = new Set(["controller_turn", "task_turn", "question_turn", "interrupt_turn"]);
const TASK_STATES: ReadonlySet<TaskState> = new Set(["in_progress", "complete_unverified", "complete_evidenced", "blocked_user", "blocked_agent_decision", "stagnating"]);
const DECISIONS: ReadonlySet<TurnState> = new Set(["DONE", "CONTINUE", "VERIFY_DONE", "NEXT_TODO", "NEEDS_DECISION", "NEEDS_USER", "RECENTER", "WAIT_FOR_USER"]);

/** Validates a decider's JSON response; returns undefined when the payload is not a well-formed decision. */
export function decodeDeciderDecision(payload: Record<string, unknown>): { classification: TurnClassification; decision: DeciderDecision } | undefined {
  const flat = decodeFlat(payload);
  if (flat) return flat;
  const assessment = asAssessment(payload.assessment);
  const action = asAction(payload.action);
  if (!assessment || !action) return undefined;
  const decision: DeciderDecision = { assessment, action };
  return {
    decision,
    classification: {
      state: action.decision,
      confidence: action.confidence,
      reason: assessment.reason,
      turn_kind: assessment.turn_kind,
      task_state: assessment.task_state,
      evidence: assessment.evidence,
    },
  };
}

function decodeFlat(payload: Record<string, unknown>): { classification: TurnClassification; decision: DeciderDecision } | undefined {
  const state = typeof payload.state === "string" ? payload.state : undefined;
  if (!state || !DECISIONS.has(state as TurnState)) return undefined;
  const confidence = typeof payload.confidence === "number" ? Math.max(0, Math.min(1, payload.confidence)) : 0;
  const turnKind = typeof payload.turn_kind === "string" && TURN_KINDS.has(payload.turn_kind as TurnKind) ? payload.turn_kind as TurnKind : undefined;
  const taskState = typeof payload.task_state === "string" && TASK_STATES.has(payload.task_state as TaskState) ? payload.task_state as TaskState : undefined;
  return {
    decision: {
      assessment: { turn_kind: turnKind ?? "task_turn", task_state: taskState ?? "in_progress", evidence: [], reason: "" },
      action: { decision: state as TurnState, confidence, auto_executable: confidence >= 0.8 },
    },
    classification: { state: state as TurnState, confidence, reason: typeof payload.reason === "string" ? payload.reason : undefined, turn_kind: turnKind, task_state: taskState },
  };
}

function asAssessment(value: unknown): DeciderAssessment | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.turn_kind !== "string" || !TURN_KINDS.has(candidate.turn_kind as TurnKind)) return undefined;
  if (typeof candidate.task_state !== "string" || !TASK_STATES.has(candidate.task_state as TaskState)) return undefined;
  if (typeof candidate.reason !== "string") return undefined;
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence.flatMap((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).type === "string" && typeof (item as Record<string, unknown>).summary === "string" ? [{ type: (item as Record<string, unknown>).type as string, summary: (item as Record<string, unknown>).summary as string }] : []) : [];
  return { turn_kind: candidate.turn_kind as TurnKind, task_state: candidate.task_state as TaskState, evidence, reason: candidate.reason };
}

function asAction(value: unknown): DeciderAction | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.decision !== "string" || !DECISIONS.has(candidate.decision as TurnState)) return undefined;
  if (typeof candidate.confidence !== "number") return undefined;
  return {
    decision: candidate.decision as TurnState,
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    auto_executable: candidate.auto_executable === true && candidate.confidence >= 0.8,
  };
}