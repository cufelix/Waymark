import { ApiError } from "../core/errors.ts";
import type { Intake } from "../contracts.ts";
import type { SeekerRecord, SeekerStore } from "./store.ts";

export class MemoryStore implements SeekerStore {
  records = new Map<string, SeekerRecord>();
  intakes = new Map<string, Intake>();
  locks = new Map<string, Promise<unknown>>();

  async create(record: SeekerRecord): Promise<void> {
    const id = record.profile.seekerId;
    if (this.records.has(id)) throw new ApiError("conflict", `Seeker ${id} already exists`);
    this.records.set(id, structuredClone(record));
  }

  async get(seekerId: string): Promise<SeekerRecord | null> {
    const r = this.records.get(seekerId);
    return r ? structuredClone(r) : null;
  }

  async update(seekerId: string, fn: (r: SeekerRecord) => SeekerRecord): Promise<SeekerRecord> {
    const prev = this.locks.get(seekerId) ?? Promise.resolve();
    const run = prev.then(() => {
      const r = this.records.get(seekerId);
      if (!r) throw new ApiError("not_found", `Seeker ${seekerId} does not exist`);
      const next = fn(structuredClone(r));
      this.records.set(seekerId, structuredClone(next));
      return structuredClone(next);
    });
    this.locks.set(seekerId, run.catch(() => undefined));
    return run;
  }

  async delete(seekerId: string): Promise<boolean> {
    this.intakes.delete(seekerId);
    return this.records.delete(seekerId);
  }

  async getIntake(seekerId: string): Promise<Intake | undefined> {
    const intake = this.intakes.get(seekerId);
    return intake ? structuredClone(intake) : undefined;
  }

  async putIntake(intake: Intake): Promise<void> {
    if (!this.records.has(intake.seekerId)) throw new ApiError("not_found", `Seeker ${intake.seekerId} does not exist`);
    this.intakes.set(intake.seekerId, structuredClone(intake));
  }
}
