import type { Validation } from "./contracts.ts";

// Owner: worker service. In-memory now, like Part 1; Postgres later.
export interface GapStore {
  put(v: Validation): Promise<void>;
  get(validationId: string): Promise<Validation | null>;
  listBySeeker(seekerId: string): Promise<Validation[]>;
  deleteBySeeker(seekerId: string): Promise<number>;
}

export class MemoryGapStore implements GapStore {
  private validations = new Map<string, Validation>();

  async put(validation: Validation): Promise<void> {
    this.validations.set(validation.validationId, structuredClone(validation));
  }

  async get(validationId: string): Promise<Validation | null> {
    const validation = this.validations.get(validationId);
    return validation ? structuredClone(validation) : null;
  }

  async listBySeeker(seekerId: string): Promise<Validation[]> {
    return [...this.validations.values()]
      .filter((validation) => validation.seekerId === seekerId)
      .map((validation) => structuredClone(validation));
  }

  async deleteBySeeker(seekerId: string): Promise<number> {
    let deleted = 0;
    for (const [id, validation] of this.validations) {
      if (validation.seekerId !== seekerId) continue;
      this.validations.delete(id);
      deleted++;
    }
    return deleted;
  }
}
