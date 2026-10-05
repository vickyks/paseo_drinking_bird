import type { DecisionRequest, DecisionResponse } from "./types.js";

export interface ReviewAgent { review(request: DecisionRequest): Promise<DecisionResponse>; }
export const reviewerContract = `You are a review-only technical decision agent. Do not implement features, edit code, or take task ownership. Resolve only the specific technical decision presented. Return a structured decision, constraints, risks, and confidence. If information is insufficient, return NEED_MORE_CONTEXT with exactly what is required.`;
export function decisionPrompt(response: Extract<DecisionResponse, { status: "DECIDED" }>): string { return `A technical review was requested.\n\nThe reviewer decided:\n${JSON.stringify(response, null, 2)}\n\nTreat this as the chosen direction and continue the existing task from your current state. Do not reopen it unless new implementation evidence directly invalidates a stated assumption.`; }
