import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { controllerTimelineKind, controllerTimelineSchema, controllerTimelineVersion, type ControllerTimelineData } from "../shared/timeline.js";

function ControllerDecision({ theme, layout, item }: PluginTimelineItemProps<ControllerTimelineData>) {
  const data = item.data;
  return (
    <View style={{ backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, padding: layout.compact ? 10 : 12, gap: 4 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Drinking Bird: {data.state}</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>Confidence: {Math.round(data.confidence * 100)}%</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>{data.reason}</Text>
    </View>
  );
}

export function contributeTimeline(client: PluginClientContext): PluginCleanup {
  return client.addTimelineRenderer({ kind: controllerTimelineKind, version: controllerTimelineVersion, schema: controllerTimelineSchema, Component: ControllerDecision });
}
