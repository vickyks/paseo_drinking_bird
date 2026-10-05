import { z } from "zod";
import type { DecisionRequest, DecisionResponse } from "./types.js";

export interface ReviewAgent { review(request: DecisionRequest): Promise<DecisionResponse>; }
export const reviewerContract = `You are a review-only technical decision agent.
You do not implement the feature, edit code, create a competing plan, or take ownership.
Resolve only the specific technical decision presented.
Return JSON matching the requested decision envelope.
If there is insufficient information, return NEED_MORE_CONTEXT and state exactly what information is required.`;

export const decisionResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DECIDED"), decision: z.string(), rationale: z.string(), implementation_constraints: z.array(z.string()).optional(), risks: z.array(z.string()).optional(), rejected_options: z.array(z.object({ option: z.string(), reason: z.string() })).optional(), confidence: z.number().min(0).max(1) }),
  z.object({ status: z.literal("NEED_MORE_CONTEXT"), required_information: z.array(z.string()).min(1) }),
]);

export function decisionPrompt(response: Extract<DecisionResponse, { status: "DECIDED" }>): string {
  return `A technical review was requested.\n\nThe reviewer has made the following decision:\n${JSON.stringify(response, null, 2)}\n\nTreat this as the chosen direction and continue the existing task from your current state. Do not reopen the decision unless new implementation evidence directly invalidates one of the reviewer's stated assumptions.`;
}

export function contextPrompt(required: string[]): string {
  return `The technical reviewer needs more context before deciding. Investigate only these questions, report concrete evidence, then pause for technical review:\n\n${required.map((item) => `- ${item}`).join("\n")}`;
}
