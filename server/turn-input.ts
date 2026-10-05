import type { AgentTimelineItem, ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHookAgent, PluginTurnOutcome } from "@getpaseo/plugin/server";
import type { TurnClassificationInput } from "../shared/types.js";
import { latestOutputText, todoItems } from "./inspect.js";

function lastUserRequest(timeline: readonly AgentTimelineItem[]): string {
  return [...timeline].reverse().find((item) => item.type === "user_message")?.text ?? "";
}

function toolCalls(timeline: readonly AgentTimelineItem[]): ToolCallTimelineItem[] {
  return timeline.filter((item): item is ToolCallTimelineItem => item.type === "tool_call");
}

function modifiedFiles(timeline: readonly AgentTimelineItem[]): string[] {
  const files = new Set<string>();
  for (const item of toolCalls(timeline)) {
    const detail = item.detail;
    if ((detail.type === "edit" || detail.type === "write") && detail.filePath) files.add(detail.filePath);
  }
  return [...files];
}

type Activity = { type: string; summary: string; success?: boolean };

function activity(timeline: readonly AgentTimelineItem[]): Activity[] {
  return timeline.flatMap((item): Activity[] => {
    if (item.type === "assistant_message") return [{ type: item.type, summary: item.text }];
    if (item.type === "reasoning") return [{ type: item.type, summary: item.text }];
    if (item.type === "error") return [{ type: item.type, summary: item.message, success: false }];
    if (item.type === "tool_call") return [{ type: item.type, summary: item.name, success: item.status === "completed" }];
    if (item.type === "todo") return [{ type: item.type, summary: item.items.map((todo) => `${todo.status ?? (todo.completed ? "completed" : "pending")}: ${todo.text}`).join("; ") }];
    return [];
  });
}

export function buildTurnClassificationInput(agent: PluginHookAgent, timeline: readonly AgentTimelineItem[], outcome: PluginTurnOutcome): TurnClassificationInput {
  const calls = toolCalls(timeline);
  const todos = todoItems(timeline);
  const errors = calls.filter((call) => call.status !== "completed").map((call) => call.error ? `${call.name}: ${String(call.error)}` : `${call.name}: ${call.status}`);
  if (outcome.kind === "failed") errors.push(outcome.error.message);
  if (outcome.kind === "canceled") errors.push(`Turn canceled: ${outcome.reason}`);

  const testCalls = calls.filter((call) => call.name === "shell" && call.detail.type === "shell" && /\b(test|check|lint|build)\b/i.test(call.detail.command));
  const testsRun = testCalls.length > 0;
  const testsPassed = testsRun ? testCalls.every((call) => call.status === "completed" && call.detail.type === "shell" && call.detail.exitCode === 0) : undefined;

  return {
    task: { original_request: lastUserRequest(timeline), goal: agent.title ?? undefined },
    plan: todos.length ? { items: todos.map((todo, index) => ({ id: todo.id ?? `todo-${index + 1}`, text: todo.text, status: todo.status === "completed" || todo.completed ? "done" : todo.status === "in_progress" ? "in_progress" : "pending" })) } : undefined,
    recent_activity: activity(timeline).slice(-20),
    last_agent_message: latestOutputText(timeline),
    runtime: {
      files_modified: modifiedFiles(timeline),
      tests_run: testsRun,
      tests_passed: testsPassed,
      unresolved_errors: errors,
    },
    explicit_blocker: outcome.kind === "failed" ? outcome.error.message : undefined,
  };
}
