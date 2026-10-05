import type { PaseoApi } from "@getpaseo/client";
import { decisionResponseSchema, reviewerContract } from "../shared/reviewer.js";
import type { DecisionRequest, DecisionResponse } from "../shared/types.js";

function parseResponse(text: string): DecisionResponse {
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1] ?? text;
  const parsed = decisionResponseSchema.safeParse(JSON.parse(candidate));
  if (!parsed.success) throw new Error(`Reviewer returned an invalid decision envelope: ${parsed.error.message}`);
  return parsed.data;
}

export async function requestTechnicalReview(paseo: PaseoApi, input: { agentId: string; parentAgentId?: string | null; cwd: string; provider: string; model?: string; request: DecisionRequest }): Promise<DecisionResponse> {
  const reviewer = await paseo.agents.create({
    parent: input.parentAgentId ?? undefined,
    cwd: input.cwd,
    title: "Drinking Bird technical review",
    autoArchive: true,
    labels: { "paseo-drinking-bird": "review-only", "parent-agent": input.agentId },
    config: { provider: input.model ? `${input.provider}/${input.model}` : input.provider, systemPrompt: reviewerContract },
  });
  const result = await reviewer.run(`Resolve this technical decision and return only the JSON decision envelope.\n\n${JSON.stringify(input.request, null, 2)}`);
  if (!result.lastMessage) throw new Error(result.error ?? `Reviewer ended with status ${result.status}`);
  return parseResponse(result.lastMessage);
}
