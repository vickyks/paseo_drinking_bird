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
- Paseo plugin entry point connected to `agent.turn_ended`;
- configurable rules, hybrid, heuristic, and HTTP classifier providers;
- configurable automatic-turn, repeated-state, and repeated-blocker limits.

The current Paseo plugin uses the `agent.turn_ended` lifecycle hook to build a structured turn snapshot and resume the same implementation agent when appropriate. Facts unavailable in the lifecycle payload remain unknown rather than being inferred from agent prose.

## Configuration

The daemon reads optional JSON configuration from `PASEO_DRINKING_BIRD_CONFIG_FILE`. Environment variables override the classifier settings:

```bash
export PASEO_DRINKING_BIRD_CONFIG_FILE="$PWD/drinking-bird.json"
export PASEO_DRINKING_BIRD_CLASSIFIER_API_KEY="..."
```

Example `drinking-bird.json`:

```json
{
  "classifier": {
    "provider": "hybrid",
    "endpoint": "http://127.0.0.1:8000/classify",
    "model": "small-controller-model",
    "auto_act_confidence": 0.8,
    "escalate_below": 0.55
  },
  "limits": {
    "max_auto_turns": 12,
    "max_repeated_state": 3,
    "max_identical_blocker_repeats": 2
  },
  "reviewer": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4o-mini",
    "max_context_round_trips": 3
  }
}
```

`rules` uses only deterministic checks. `hybrid` uses those checks first and falls back to the configured HTTP classifier, or the local heuristic classifier when no endpoint is configured. `jev`, `openai`, and `local` all use the provider-neutral HTTP contract; the orchestration layer does not depend on the provider name. Reviewer delegation is disabled by default until a reviewer provider is configured; enabling it creates a separate review-only child agent and returns its structured decision to the original agent.

A visible Playwright demo is also opt-in:

```json
{
  "demo": {
    "enabled": true,
    "plan_file": "./demo-plan.json",
    "base_url": "http://localhost:3000",
    "evidence_dir": "./drinking-bird-demo-evidence",
    "command": "npx",
    "args": ["playwright", "test", "./demo-plan.json"],
    "headless": false,
    "speed": 1
  }
}
```

The plugin invokes the configured external Playwright runner with environment variables containing the plan, evidence directory, base URL, visibility, speed, and pacing configuration. Keep Playwright and its browser executable in the application workspace or a separately managed tool environment rather than bundling them into the Paseo plugin. The runner should preserve screenshots and browser errors in `evidence_dir`.

A demo failure sends `VERIFY_DONE` guidance to the original implementation agent; it never silently turns a failed demo into task completion.

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
