import { randomBytes } from "node:crypto";

export type IdPrefix = "skr" | "doc" | "lnk" | "clm" | "src" | "req";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ULID: 48-bit ms timestamp + 80 random bits, Crockford base32, 26 chars.
export function ulid(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

// API.md: IDs are prefix_ + ULID, minted by the part that creates the object.
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
