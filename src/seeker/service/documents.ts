import type { Claim, SeekerDocument } from "../contracts.ts";
import { cvSource, now, statedSkillClaim } from "../core/claims.ts";
import { ApiError } from "../core/errors.ts";
import { newId } from "../core/ids.ts";
import { mergeStatedSkills, removeSources, touch } from "../core/profile.ts";
import { detectCvKind, extractCvDetails, extractCvText, quoteAppearsInText } from "../cv/extract.ts";
import type { LlmClient } from "../llm/llm.ts";
import type { SeekerStore } from "../store/store.ts";
import { findSkill } from "../taxonomy.ts";

export { SUPPORTED_CV_FORMATS } from "../cv/extract.ts";

const MAX_CV_BYTES = 10 * 1024 * 1024;

export type Deps = { store: SeekerStore; llm: LlmClient };

function seekerNotFound(seekerId: string): ApiError {
  return new ApiError("not_found", `Seeker ${seekerId} does not exist`);
}

export async function uploadCv(
  deps: Deps,
  seekerId: string,
  file: { fileName: string; mimeType: string; bytes: Uint8Array },
): Promise<SeekerDocument> {
  const record = await deps.store.get(seekerId);
  if (!record || record.deletionPending) throw seekerNotFound(seekerId);
  if (file.bytes.byteLength > MAX_CV_BYTES) throw new ApiError("unprocessable", "CV must not exceed 10 MB");

  const kind = detectCvKind(file.mimeType, file.bytes);
  const documentId = newId("doc");
  const text = await extractCvText(deps.llm, file, kind);
  const extracted = await extractCvDetails(deps.llm, text);

  const claims: Claim[] = [];
  for (const candidate of extracted.skills) {
    if (!quoteAppearsInText(text, candidate.quote)) continue;
    const skill = await findSkill(candidate.label);
    claims.push(statedSkillClaim(seekerId, skill, cvSource(documentId, file.fileName, file.bytes, candidate.quote)));
  }
  const statedSkills = mergeStatedSkills([], claims);
  const document: SeekerDocument = {
    id: documentId,
    kind: "cv",
    fileName: file.fileName,
    uploadedAt: now(),
    statedSkills,
    experience: extracted.experience,
    education: extracted.education,
  };

  await deps.store.update(seekerId, (current) => {
    if (current.deletionPending) throw seekerNotFound(seekerId);
    return {
      ...current,
      cvTexts: { ...current.cvTexts, [documentId]: text },
      profile: touch({
        ...current.profile,
        documents: [...current.profile.documents, document],
        statedSkills: mergeStatedSkills(current.profile.statedSkills, statedSkills),
      }),
    };
  });
  return document;
}

export async function deleteDocument(deps: Deps, seekerId: string, documentId: string): Promise<{ deleted: true }> {
  await deps.store.update(seekerId, (record) => {
    if (record.deletionPending) throw seekerNotFound(seekerId);
    if (!record.profile.documents.some((document) => document.id === documentId)) {
      throw new ApiError("not_found", `Document ${documentId} does not exist`);
    }
    const cvTexts = { ...record.cvTexts };
    delete cvTexts[documentId];
    return {
      ...record,
      cvTexts,
      profile: touch({
        ...record.profile,
        documents: record.profile.documents.filter((document) => document.id !== documentId),
        statedSkills: removeSources(record.profile.statedSkills, `seeker-upload://${documentId}`),
      }),
    };
  });
  return { deleted: true };
}
