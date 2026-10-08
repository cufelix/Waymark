import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { config } from "../config";
import { sha256 } from "../ids";

// ponytail: raw snapshots on local disk, move behind S3-compatible storage when the disk is too small
const root = resolve(config.SNAPSHOT_DIR);

/** Resolves a snapshot key to a path inside the snapshot directory, refusing anything that escapes it. */
function pathFor(key: string): string {
  const p = resolve(root, key);
  if (!p.startsWith(root + sep)) throw new Error("invalid snapshot key");
  return p;
}

/** Stores raw content by its hash. Returns the key and the hash. Same content is stored once. */
export async function saveSnapshot(content: string | Buffer, ext = "txt"): Promise<{ key: string; hash: string }> {
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error("invalid snapshot extension");
  const hash = sha256(content);
  const key = `${hash.slice(0, 2)}/${hash}.${ext}`;
  await mkdir(dirname(pathFor(key)), { recursive: true });
  await writeFile(pathFor(key), content);
  return { key, hash };
}

export const readSnapshot = (key: string): Promise<Buffer> => readFile(pathFor(key));

export const deleteSnapshot = (key: string): Promise<void> => rm(pathFor(key), { force: true });
