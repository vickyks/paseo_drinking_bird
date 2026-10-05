# Paseo Drinking Bird

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

Paseo's current plugin SDK does not expose a generic end-of-turn lifecycle hook. The core therefore takes an explicit turn snapshot and runtime adapter, which keeps orchestration testable and prevents the plugin from guessing facts unavailable through the SDK. A future Paseo lifecycle event can call `ContinuationController.evaluate` directly without changing classification or orchestration behavior.

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
