import type { CareerPreferencesDraft, Intake, InterviewTurn, SeekerProfile } from "../contracts.ts";

// Everything Part 1 persists for one seeker. Every method is scoped by seekerId
// (PLAN.md §7: one seeker can never read another's data).
export type SeekerRecord = {
  profile: SeekerProfile;
  interview: InterviewTurn[];
  draft: CareerPreferencesDraft; // what the interview has filled in so far
  cvTexts: Record<string, string>; // documentId -> extracted text, deleted with the document
  deletionPending?: boolean;
};

// In-memory now; a Postgres implementation replaces it once A's migrations land.
export interface SeekerStore {
  create(record: SeekerRecord): Promise<void>;
  get(seekerId: string): Promise<SeekerRecord | null>;
  // Read-modify-write under a per-seeker lock; return the updated record.
  update(seekerId: string, fn: (r: SeekerRecord) => SeekerRecord): Promise<SeekerRecord>;
  // Update the profile record and guided intake under the same per-seeker lock.
  updateRecordAndIntake(
    seekerId: string,
    fn: (record: SeekerRecord, intake: Intake) => { record: SeekerRecord; intake: Intake },
  ): Promise<{ record: SeekerRecord; intake: Intake }>;
  getIntake(seekerId: string): Promise<Intake | undefined>;
  putIntake(intake: Intake): Promise<void>;
  delete(seekerId: string): Promise<boolean>;
}
