import { createHash } from "node:crypto";
import { ulid } from "ulid";

export type IdPrefix = "run" | "cmp" | "vac" | "clm" | "src" | "art" | "req";

export const newId = (prefix: IdPrefix): string => `${prefix}_${ulid().toLowerCase()}`;

export const sha256 = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");
