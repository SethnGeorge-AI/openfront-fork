import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** Finishes the capital's timed upgrade once its tick arrives. */
export class CapitalExecution implements Execution {
  private active = true;
  private mg: Game | undefined;

  constructor(private capital: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.capital.isActive()) {
      this.active = false;
      return;
    }
    const at = this.capital.capitalUpgradeAt();
    if (at !== null && ticks >= at) this.capital.increaseLevel();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CapitalExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      capital: w.unit(this.capital),
    });
  }

  restoreSnapshot(s: CapitalState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.capital = r.unit(s.capital);
  }
}

const CapitalStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  capital: zRef(),
});
type CapitalState = z.infer<typeof CapitalStateSchema>;

export const CapitalExecutionSnapshot = execSnapshotType({
  name: "Capital",
  version: 1,
  schema: CapitalStateSchema,
  cls: () => CapitalExecution,
});
