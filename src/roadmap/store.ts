import type { Roadmap } from "./contracts.ts";

export interface RoadmapStore {
  put(r: Roadmap): Promise<void>;
  replaceIfExists(r: Roadmap): Promise<boolean>; // atomic: never re-creates a roadmap deleted meanwhile
  failBuildingOlderThan(cutoff: string, failure: { error: NonNullable<Roadmap["error"]>; updatedAt: string }): Promise<number>;
  get(id: string): Promise<Roadmap | undefined>;
  listBySeeker(seekerId: string): Promise<Roadmap[]>;
  deleteBySeeker(seekerId: string): Promise<number>;
}

export class MemoryRoadmapStore implements RoadmapStore {
  private roadmaps = new Map<string, Roadmap>();

  async put(roadmap: Roadmap): Promise<void> {
    this.roadmaps.set(roadmap.roadmapId, structuredClone(roadmap));
  }

  async replaceIfExists(roadmap: Roadmap): Promise<boolean> {
    if (!this.roadmaps.has(roadmap.roadmapId)) return false;
    this.roadmaps.set(roadmap.roadmapId, structuredClone(roadmap));
    return true;
  }

  async failBuildingOlderThan(
    cutoff: string,
    failure: { error: NonNullable<Roadmap["error"]>; updatedAt: string },
  ): Promise<number> {
    let failed = 0;
    for (const [id, roadmap] of this.roadmaps) {
      if (roadmap.status !== "building" || roadmap.updatedAt > cutoff) continue;
      this.roadmaps.set(id, structuredClone({ ...roadmap, status: "failed", ...failure }));
      failed++;
    }
    return failed;
  }

  async get(id: string): Promise<Roadmap | undefined> {
    const roadmap = this.roadmaps.get(id);
    return roadmap === undefined ? undefined : structuredClone(roadmap);
  }

  async listBySeeker(seekerId: string): Promise<Roadmap[]> {
    return [...this.roadmaps.values()]
      .filter((roadmap) => roadmap.seekerId === seekerId)
      .map((roadmap) => structuredClone(roadmap));
  }

  async deleteBySeeker(seekerId: string): Promise<number> {
    let deleted = 0;
    for (const [id, roadmap] of this.roadmaps) {
      if (roadmap.seekerId !== seekerId) continue;
      this.roadmaps.delete(id);
      deleted++;
    }
    return deleted;
  }
}
