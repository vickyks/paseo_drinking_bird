# Paseo Drinking Bird

![Homer Simpson's automatic drinking bird keeps working from home](https://i.makeagif.com/media/7-28-2014/AnSME7.gif)

> Inspired by Homer's automatic drinking bird from *The Simpsons*: the unattended worker that keeps hitting the keyboard so the job keeps moving.

A Jev-agnostic continuation controller add-on for Paseo. It keeps the original implementation agent as task owner while classifying completed turns as `DONE`, `CONTINUE`, `VERIFY_DONE`, `NEXT_TODO`, `NEEDS_DECISION`, or `NEEDS_USER`.

## Current implementation

The repository contains a production-oriented Phase 1 core:

- provider-neutral `TurnClassifier` interface and deterministic rules classifier;
- deterministic completion checks before fuzzy classification;
- continuation, verification, and next-todo prompts sent to the same agent;
- loop protection for turn count, repeated states, repeated blockers, and stagnant fingerprints;
- structured controller events for observability;
- review-only decision contract and decision injection prompt;
- human-watchable demo runner with visible-browser pacing abstraction;
- Paseo plugin entry point exposing a supervised-agent RPC.

The current Paseo plugin uses the `agent.turn_ended` lifecycle hook to build a structured turn snapshot and resume the same implementation agent when appropriate. Facts unavailable in the lifecycle payload remain unknown rather than being inferred from agent prose.

## Development

```bash
npm install
npm test
npm run typecheck
```

Install locally with `paseo plugin install "$(pwd)"` after building.

## Architecture

`src/controller.ts` owns orchestration. `src/classifier.ts` owns classification providers. `src/safety.ts` owns loop limits. `src/reviewer.ts` defines the review-only boundary. `src/demo.ts` keeps demonstration separate from validation and accepts a Playwright-compatible adapter.

The controller never treats agent prose as authoritative: callers provide structured plan and runtime evidence, and deterministic checks take precedence over model classification.
