import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeTimeline } from "./client/controller-timeline.js";

export default function contribute(client: PluginClientContext): PluginCleanup {
  return contributeTimeline(client);
}
