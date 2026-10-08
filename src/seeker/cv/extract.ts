import { inflateRawSync } from "node:zlib";
import { ApiError } from "../core/errors.ts";
import type { LlmClient } from "../llm/llm.ts";
import { MODELS } from "../llm/llm.ts";

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_LOCAL_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const MAX_DOCX_XML_BYTES = 20 * 1024 * 1024;

export type CvExtraction = {
  skills: { label: string; quote: string }[];
  experience: { title: string; organisation?: string; from?: string; to?: string }[];
  education: { title: string; institution?: string; from?: string; to?: string }[];
};

export type CvFileKind = "pdf" | "docx";

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function unprocessable(message: string): never {
  throw new ApiError("unprocessable", message);
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) unprocessable("Invalid DOCX archive");
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) unprocessable("Invalid DOCX archive");
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  // EOCD plus the maximum legal ZIP comment is at most 65,557 bytes from EOF.
  const first = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= first; offset--) {
    if (readU32(bytes, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function decodeZipName(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function readDocxDocumentXml(bytes: Uint8Array): string {
  if (!startsWith(bytes, ZIP_LOCAL_MAGIC)) unprocessable("CV must be a valid DOCX file");

  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) unprocessable("Invalid DOCX archive");
  const entryCount = readU16(bytes, eocd + 10);
  const centralSize = readU32(bytes, eocd + 12);
  const centralOffset = readU32(bytes, eocd + 16);
  if (centralOffset + centralSize > eocd || entryCount > 10_000) unprocessable("Invalid DOCX archive");

  let offset = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (readU32(bytes, offset) !== 0x02014b50) unprocessable("Invalid DOCX archive");
    const compression = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20);
    const uncompressedSize = readU32(bytes, offset + 24);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const localOffset = readU32(bytes, offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > centralOffset + centralSize || nextOffset > bytes.length) unprocessable("Invalid DOCX archive");
    const name = decodeZipName(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === "word/document.xml") {
      if (uncompressedSize > MAX_DOCX_XML_BYTES) unprocessable("DOCX document text is too large");
      if (readU32(bytes, localOffset) !== 0x04034b50) unprocessable("Invalid DOCX archive");
      const localNameLength = readU16(bytes, localOffset + 26);
      const localExtraLength = readU16(bytes, localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset + compressedSize > bytes.length) unprocessable("Invalid DOCX archive");
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);

      let xmlBytes: Uint8Array;
      try {
        if (compression === 0) xmlBytes = compressed;
        else if (compression === 8) xmlBytes = inflateRawSync(compressed, { maxOutputLength: MAX_DOCX_XML_BYTES });
        else unprocessable("DOCX uses an unsupported compression method");
      } catch (error) {
        if (error instanceof ApiError) throw error;
        unprocessable("Invalid compressed data in DOCX archive");
      }
      if (xmlBytes.length !== uncompressedSize) unprocessable("Invalid DOCX archive");
      return new TextDecoder("utf-8", { fatal: false }).decode(xmlBytes);
    }
    offset = nextOffset;
  }

  return unprocessable("DOCX is missing word/document.xml");
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, value: string) => {
    if (value[0] === "#") {
      const radix = value[1]?.toLowerCase() === "x" ? 16 : 10;
      const digits = radix === 16 ? value.slice(2) : value.slice(1);
      const codePoint = Number.parseInt(digits, radix);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return "\ufffd";
      }
      return String.fromCodePoint(codePoint);
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[value.toLowerCase()];
  });
}

export function docxXmlToText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, "\n")
      .replace(/<\/w:p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function detectCvKind(mimeType: string, bytes: Uint8Array): CvFileKind {
  if (mimeType === "application/pdf" && startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && startsWith(bytes, ZIP_LOCAL_MAGIC)) {
    // Reading the entry is also the structural/magic check required for DOCX.
    readDocxDocumentXml(bytes);
    return "docx";
  }
  return unprocessable("CV must be a PDF or DOCX file");
}

export async function extractCvText(llm: LlmClient, file: { fileName: string; mimeType: string; bytes: Uint8Array }, kind: CvFileKind): Promise<string> {
  let text: string;
  if (kind === "docx") {
    text = docxXmlToText(readDocxDocumentXml(file.bytes));
  } else {
    const fileData = `data:application/pdf;base64,${Buffer.from(file.bytes).toString("base64")}`;
    try {
      text = await llm.chat({
        model: MODELS.fast,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe this CV verbatim as plain text. Preserve all wording. Do not summarise, infer, judge, or score the person." },
              { type: "file", file: { filename: file.fileName, file_data: fileData } },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("upstream_failed", "Could not transcribe PDF CV");
    }
  }
  text = text.trim();
  if (!text) unprocessable("CV contains no extractable text");
  return text;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parseExtraction(raw: string): CvExtraction | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (!Array.isArray(object.skills) || !Array.isArray(object.experience) || !Array.isArray(object.education)) return null;

  const skills: CvExtraction["skills"] = [];
  for (const item of object.skills) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const skill = item as Record<string, unknown>;
    if (typeof skill.label !== "string" || !skill.label.trim() || typeof skill.quote !== "string" || !skill.quote.trim()) return null;
    skills.push({ label: skill.label.trim(), quote: skill.quote });
  }

  const experience: CvExtraction["experience"] = [];
  for (const item of object.experience) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.title !== "string" || !entry.title.trim() || !optionalString(entry.organisation) || !optionalString(entry.from) || !optionalString(entry.to)) return null;
    experience.push({
      title: entry.title.trim(),
      ...(entry.organisation !== undefined ? { organisation: entry.organisation } : {}),
      ...(entry.from !== undefined ? { from: entry.from } : {}),
      ...(entry.to !== undefined ? { to: entry.to } : {}),
    });
  }

  const education: CvExtraction["education"] = [];
  for (const item of object.education) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.title !== "string" || !entry.title.trim() || !optionalString(entry.institution) || !optionalString(entry.from) || !optionalString(entry.to)) return null;
    education.push({
      title: entry.title.trim(),
      ...(entry.institution !== undefined ? { institution: entry.institution } : {}),
      ...(entry.from !== undefined ? { from: entry.from } : {}),
      ...(entry.to !== undefined ? { to: entry.to } : {}),
    });
  }
  return { skills, experience, education };
}

export async function extractCvDetails(llm: LlmClient, text: string): Promise<CvExtraction> {
  const prompt = [
    "Extract only information explicitly stated in this CV. Never infer, judge, rank, or score the person.",
    "Return JSON with exactly these arrays:",
    '{"skills":[{"label":"skill name","quote":"verbatim supporting quote from the CV"}],"experience":[{"title":"...","organisation":"...","from":"...","to":"..."}],"education":[{"title":"...","institution":"...","from":"...","to":"..."}]}',
    "Use only strings. Omit unavailable optional fields. Every skill quote must be copied verbatim from the CV text.",
    "\nCV TEXT:\n",
    text,
  ].join("\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await llm.chat({ model: MODELS.cv, json: true, temperature: 0, messages: [{ role: "user", content: prompt }] });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("upstream_failed", "Could not extract CV details");
    }
    const parsed = parseExtraction(raw);
    if (parsed) return parsed;
  }
  throw new ApiError("upstream_failed", "CV extraction returned invalid JSON");
}

export function quoteAppearsInText(text: string, quote: string): boolean {
  const normaliseWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
  const normalisedQuote = normaliseWhitespace(quote);
  return normalisedQuote.length > 0 && normaliseWhitespace(text).includes(normalisedQuote);
}
