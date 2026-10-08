import type { Roadmap } from "./contracts.ts";

export interface RoadmapStore {
  put(r: Roadmap): Promise<void>;
  get(id: string): Promise<Roadmap | undefined>;
  listBySeeker(seekerId: string): Promise<Roadmap[]>;
  deleteBySeeker(seekerId: string): Promise<number>;
}

export class MemoryRoadmapStore implements RoadmapStore {
  private roadmaps = new Map<string, Roadmap>();

  async put(roadmap: Roadmap): Promise<void> {
    this.roadmaps.set(roadmap.roadmapId, structuredClone(roadmap));
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
