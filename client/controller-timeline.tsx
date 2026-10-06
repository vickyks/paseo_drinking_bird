import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import { controllerTimelineKind, controllerTimelineSchema, controllerTimelineVersion, type ControllerTimelineData } from "../shared/timeline.js";
import { supervisionRpc } from "../shared/supervision.js";

const stateLabels: Partial<Record<ControllerTimelineData["state"], string>> = {
  DONE: "Task complete",
  CONTINUE: "Continuation",
  VERIFY_DONE: "Verify before done",
  NEXT_TODO: "Next to-do",
  NEEDS_DECISION: "Technical decision required",
  NEEDS_USER: "Needs user input",
  RECENTER: "Possible loop detected — recenter proposed",
  WAIT_FOR_USER: "Waiting for you",
};

function ControllerDecision({ theme, layout, agentId, item }: PluginTimelineItemProps<ControllerTimelineData>) {
  const data = item.data;
  const supervise = useRpc(supervisionRpc);
  return (
    <View style={{ backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, padding: layout.compact ? 10 : 12, gap: 4 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Drinking Bird: {stateLabels[data.state] ?? data.state}</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>Confidence: {Math.round(data.confidence * 100)}%</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>{data.reason}</Text>
      {data.action_status === "pending" && <Text style={{ color: theme.colors.statusWarning }}>Pending approval — use /drinking-bird approve or reject</Text>}
      {data.action_status === "approved" && <Text style={{ color: theme.colors.statusSuccess }}>Approved</Text>}
      {data.action_status === "rejected" && <Text style={{ color: theme.colors.statusDanger }}>Rejected</Text>}
      {data.prompt && <Text style={{ color: theme.colors.foregroundMuted }}>Proposed action: {data.prompt}</Text>}
      {data.action_status === "pending" && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Approve Drinking Bird action" onPress={() => supervise({ agentId, action: "approve" })} style={{ backgroundColor: theme.colors.accent, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: theme.colors.accentForeground, fontWeight: "600" }}>Approve</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Reject Drinking Bird action" onPress={() => supervise({ agentId, action: "reject" })} style={{ borderColor: theme.colors.statusDanger, borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: theme.colors.statusDanger, fontWeight: "600" }}>Reject</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function contributeTimeline(client: PluginClientContext): PluginCleanup {
  const removeLegacy = client.addTimelineRenderer({ kind: controllerTimelineKind, version: 1, schema: controllerTimelineSchema, Component: ControllerDecision });
  const removeCurrent = client.addTimelineRenderer({ kind: controllerTimelineKind, version: controllerTimelineVersion, schema: controllerTimelineSchema, Component: ControllerDecision });
  return () => { removeLegacy(); removeCurrent(); };
}
