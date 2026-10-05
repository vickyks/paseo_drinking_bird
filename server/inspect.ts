import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export function latestOutputText(timeline: readonly AgentTimelineItem[]): string {
  let userMessageSeen = false;
  const output: string[] = [];
  for (const item of timeline) {
    if (item.type === "user_message") {
      userMessageSeen = true;
      output.length = 0;
      continue;
    }
    if (userMessageSeen && item.type === "assistant_message") output.push(item.text);
  }
  return output.join("\n").trim();
}

export function todoItems(timeline: readonly AgentTimelineItem[]) {
  return timeline.filter((item) => item.type === "todo").at(-1)?.items ?? [];
}
