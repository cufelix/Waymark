import type { Validation } from "./contracts.ts";

// Owner: worker service. In-memory now, like Part 1; Postgres later.
export interface GapStore {
  put(v: Validation): Promise<void>;
  get(validationId: string): Promise<Validation | null>;
  listBySeeker(seekerId: string): Promise<Validation[]>;
  deleteBySeeker(seekerId: string): Promise<number>;
}
