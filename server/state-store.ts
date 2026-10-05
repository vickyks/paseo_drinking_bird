import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LoopGuardState } from "../shared/safety.js";

export interface PendingActionState {
  timelineId: string;
  turnId: string | null;
  state: "CONTINUE" | "VERIFY_DONE" | "NEXT_TODO";
  prompt: string;
  reason: string;
  confidence: number;
}

export interface PersistedAgentState {
  guard: LoopGuardState;
  reviewerContextRounds?: number;
  pendingAction?: PendingActionState;
  updatedAt: string;
}

type StateFile = Record<string, PersistedAgentState>;

export class StateStore {
  private readonly path: string;
  private loaded: StateFile | undefined;

  constructor(path = process.env.PASEO_DRINKING_BIRD_STATE_FILE ?? join(homedir(), ".paseo", "paseo-drinking-bird", "state.json")) {
    this.path = path;
  }

  private async read(): Promise<StateFile> {
    if (this.loaded) return this.loaded;
    try {
      this.loaded = JSON.parse(await readFile(this.path, "utf8")) as StateFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.loaded = {};
    }
    return this.loaded;
  }

  async get(agentId: string): Promise<PersistedAgentState | undefined> {
    return (await this.read())[agentId];
  }

  async set(agentId: string, state: PersistedAgentState): Promise<void> {
    const values = await this.read();
    values[agentId] = state;
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }

  async delete(agentId: string): Promise<void> {
    const values = await this.read();
    delete values[agentId];
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}
