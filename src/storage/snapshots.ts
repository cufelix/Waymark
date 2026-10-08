import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config";
import { sha256 } from "../ids";

// ponytail: raw snapshots on local disk, move behind S3-compatible storage when the disk is too small
const pathFor = (key: string): string => join(config.SNAPSHOT_DIR, key);

/** Stores raw content by its hash. Returns the key and the hash. Same content is stored once. */
export async function saveSnapshot(content: string | Buffer, ext = "txt"): Promise<{ key: string; hash: string }> {
  const hash = sha256(content);
  const key = `${hash.slice(0, 2)}/${hash}.${ext}`;
  await mkdir(dirname(pathFor(key)), { recursive: true });
  await writeFile(pathFor(key), content);
  return { key, hash };
}

export const readSnapshot = (key: string): Promise<Buffer> => readFile(pathFor(key));

export const deleteSnapshot = (key: string): Promise<void> => rm(pathFor(key), { force: true });
