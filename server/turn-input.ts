import type { AgentTimelineItem, ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHookAgent, PluginTurnOutcome } from "@getpaseo/plugin/server";
import type { TurnClassificationInput } from "../shared/types.js";
import { latestOutputText, todoItems } from "./inspect.js";

function userRequests(timeline: readonly AgentTimelineItem[]): string[] {
  return [...timeline].reverse().filter((item) => item.type === "user_message").map((item) => item.text).reverse();
}

function currentTurn(timeline: readonly AgentTimelineItem[]): readonly AgentTimelineItem[] {
  const lastUserIndex = [...timeline].map((item) => item.type).lastIndexOf("user_message");
  return lastUserIndex >= 0 ? timeline.slice(lastUserIndex) : timeline;
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
  const turnTimeline = currentTurn(timeline);
  const calls = toolCalls(turnTimeline);
  const todos = todoItems(turnTimeline);
  const errors = calls.filter((call) => call.status !== "completed").map((call) => call.error ? `${call.name}: ${String(call.error)}` : `${call.name}: ${call.status}`);
  if (outcome.kind === "failed") errors.push(outcome.error.message);
  if (outcome.kind === "canceled") errors.push(`Turn canceled: ${outcome.reason}`);

  const output = latestOutputText(turnTimeline);
  const testCalls = calls.filter((call) => call.detail.type === "shell" && /\b(test|check|lint|build)\b/i.test(call.detail.command));
  const testResultMentioned = /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|\btests?\s+passed\b/i.test(output);
  const testsRun = testCalls.length > 0 || testResultMentioned;
  const structuredTestsPassed = testCalls.length > 0 && testCalls.every((call) => call.status === "completed" && call.detail.type === "shell" && (call.detail.exitCode === 0 || call.detail.exitCode === null || call.detail.exitCode === undefined));
  const testsPassed = testsRun ? (testCalls.length > 0 ? structuredTestsPassed : testResultMentioned && calls.some((call) => call.status === "completed")) : undefined;

  const requests = userRequests(timeline);
  const firstRequest = requests[0];
  const lastUserMessage = requests[requests.length - 1];

  return {
    task: { original_request: firstRequest ?? lastUserMessage, goal: agent.title ?? undefined },
    last_user_message: lastUserMessage,
    plan: todos.length ? { items: todos.map((todo, index) => ({ id: todo.id ?? `todo-${index + 1}`, text: todo.text, status: todo.status === "completed" || todo.completed ? "done" : todo.status === "in_progress" ? "in_progress" : "pending" })) } : undefined,
    recent_activity: activity(turnTimeline).slice(-20),
    last_agent_message: output,
    runtime: {
      files_modified: modifiedFiles(timeline),
      tests_run: testsRun,
      tests_passed: testsPassed,
      unresolved_errors: errors,
    },
    explicit_blocker: outcome.kind === "failed" ? outcome.error.message : undefined,
  };
}
