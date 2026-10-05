export type TurnState =
  | "DONE"
  | "CONTINUE"
  | "VERIFY_DONE"
  | "NEXT_TODO"
  | "NEEDS_DECISION"
  | "NEEDS_USER";

export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";

export interface TurnClassificationInput {
  task: { original_request: string; goal?: string; success_criteria?: string[] };
  plan?: { items: Array<{ id: string; text: string; status: TodoStatus }> };
  recent_activity: Array<{ type: string; summary: string; success?: boolean }>;
  last_agent_message: string;
  runtime?: {
    files_modified?: string[];
    tests_run?: boolean;
    tests_passed?: boolean;
    working_tree_clean?: boolean;
    branch?: string;
    commit_created?: boolean;
    mr_required?: boolean;
    mr_created?: boolean;
    unresolved_errors?: string[];
  };
  explicit_blocker?: string;
}

export interface TurnClassification {
  state: TurnState;
  confidence: number;
  reason?: string;
  decision?: DecisionRequest;
}

export interface DecisionRequest {
  task_summary: string;
  decision_required: string;
  options?: Array<{ id: string; description: string }>;
  constraints?: string[];
  implementation_context?: string;
  agent_recommendation?: { option?: string; rationale?: string };
  evidence?: Array<{ type: string; summary: string }>;
}

export type DecisionResponse =
  | { status: "DECIDED"; decision: string; rationale: string; implementation_constraints?: string[]; risks?: string[]; rejected_options?: Array<{ option: string; reason: string }>; confidence: number }
  | { status: "NEED_MORE_CONTEXT"; required_information: string[] };

export type ClassifierProvider = "rules" | "hybrid" | "jev" | "openai" | "local";

export interface ClassifierConfig {
  provider: ClassifierProvider;
  endpoint?: string;
  model?: string;
  api_key?: string;
  deterministic_first?: boolean;
  auto_act_confidence?: number;
  escalate_below?: number;
}

export interface ControllerConfig {
  max_auto_turns: number;
  max_repeated_state: number;
  max_identical_blocker_repeats: number;
}

export interface ControllerAction {
  state: TurnState;
  prompt?: string;
  reason: string;
  confidence: number;
}
