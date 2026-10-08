import { inflateRawSync } from "node:zlib";
import { ApiError } from "../core/errors.ts";
import type { LlmClient } from "../llm/llm.ts";
import { MODELS } from "../llm/llm.ts";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ODT_MIME = "application/vnd.oasis.opendocument.text";
const TXT_MIME = "text/plain";
const MARKDOWN_MIME = "text/markdown";
const JPEG_MIME = "image/jpeg";
const PNG_MIME = "image/png";
const WEBP_MIME = "image/webp";

export const SUPPORTED_CV_FORMATS = [
  { mime: PDF_MIME, label: "PDF" },
  { mime: DOCX_MIME, label: "DOCX" },
  { mime: TXT_MIME, label: "TXT" },
  { mime: MARKDOWN_MIME, label: "Markdown" },
  { mime: ODT_MIME, label: "ODT" },
  { mime: JPEG_MIME, label: "JPEG" },
  { mime: PNG_MIME, label: "PNG" },
  { mime: WEBP_MIME, label: "WebP" },
] as const;

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_LOCAL_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024;
const MAX_MIMETYPE_BYTES = 1_024;
const TRANSCRIPTION_INSTRUCTION = "Transcribe this CV verbatim as plain text. Preserve all wording. Do not summarise, infer, judge, or score the person.";
const UNSUPPORTED_FORMAT_MESSAGE = `CV must be a supported format: ${SUPPORTED_CV_FORMATS.map(({ label }) => label).join(", ")}`;

export type CvExtraction = {
  skills: { label: string; quote: string }[];
  experience: { title: string; organisation?: string; from?: string; to?: string }[];
  education: { title: string; institution?: string; from?: string; to?: string }[];
};

export type CvFileKind = "pdf" | "docx" | "txt" | "markdown" | "odt" | "jpeg" | "png" | "webp";

type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 // RIFF
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // WEBP
}

function unprocessable(message: string): never {
  throw new ApiError("unprocessable", message);
}

function invalidArchive(format: string): never {
  return unprocessable(`Invalid ${format} archive`);
}

function readU16(bytes: Uint8Array, offset: number, format: string): number {
  if (offset < 0 || offset + 2 > bytes.length) invalidArchive(format);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number, format: string): number {
  if (offset < 0 || offset + 4 > bytes.length) invalidArchive(format);
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array, format: string): number {
  // EOCD plus the maximum legal ZIP comment is at most 65,557 bytes from EOF.
  const first = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= first; offset--) {
    if (readU32(bytes, offset, format) === 0x06054b50) return offset;
  }
  return -1;
}

function decodeZipName(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function readZipDirectory(bytes: Uint8Array, format: string): ZipEntry[] {
  if (!startsWith(bytes, ZIP_LOCAL_MAGIC)) unprocessable(`CV must be a valid ${format} file`);

  const eocd = findEndOfCentralDirectory(bytes, format);
  if (eocd < 0) invalidArchive(format);
  const entryCount = readU16(bytes, eocd + 10, format);
  const centralSize = readU32(bytes, eocd + 12, format);
  const centralOffset = readU32(bytes, eocd + 16, format);
  if (centralOffset + centralSize > eocd || entryCount > MAX_ARCHIVE_ENTRIES) invalidArchive(format);

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (readU32(bytes, offset, format) !== 0x02014b50) invalidArchive(format);
    const compression = readU16(bytes, offset + 10, format);
    const compressedSize = readU32(bytes, offset + 20, format);
    const uncompressedSize = readU32(bytes, offset + 24, format);
    const nameLength = readU16(bytes, offset + 28, format);
    const extraLength = readU16(bytes, offset + 30, format);
    const commentLength = readU16(bytes, offset + 32, format);
    const localOffset = readU32(bytes, offset + 42, format);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > centralOffset + centralSize || nextOffset > bytes.length) invalidArchive(format);
    const name = decodeZipName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (entries.some((entry) => entry.name === name)) invalidArchive(format);
    entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
    offset = nextOffset;
  }
  return entries;
}

function readZipEntry(
  bytes: Uint8Array,
  entries: ZipEntry[],
  entryName: string,
  format: string,
  maxOutputLength: number,
  tooLargeMessage: string,
): Uint8Array | null {
  const entry = entries.find(({ name }) => name === entryName);
  if (!entry) return null;
  if (entry.uncompressedSize > maxOutputLength) unprocessable(tooLargeMessage);
  if (readU32(bytes, entry.localOffset, format) !== 0x04034b50) invalidArchive(format);
  const localNameLength = readU16(bytes, entry.localOffset + 26, format);
  const localExtraLength = readU16(bytes, entry.localOffset + 28, format);
  const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
  if (dataOffset + entry.compressedSize > bytes.length) invalidArchive(format);
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);

  let content: Uint8Array;
  try {
    if (entry.compression === 0) content = compressed;
    else if (entry.compression === 8) content = inflateRawSync(compressed, { maxOutputLength });
    else unprocessable(`${format} uses an unsupported compression method`);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    unprocessable(`Invalid compressed data in ${format} archive`);
  }
  if (content.length !== entry.uncompressedSize) invalidArchive(format);
  return content;
}

function decodeXml(bytes: Uint8Array, format: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unprocessable(`${format} document XML must be valid UTF-8`);
  }
}

export function readDocxDocumentXml(bytes: Uint8Array): string {
  const entries = readZipDirectory(bytes, "DOCX");
  const xmlBytes = readZipEntry(
    bytes,
    entries,
    "word/document.xml",
    "DOCX",
    MAX_DOCUMENT_XML_BYTES,
    "DOCX document text is too large",
  );
  if (!xmlBytes) return unprocessable("DOCX is missing word/document.xml");
  return decodeXml(xmlBytes, "DOCX");
}

function decodeOdtMimetype(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unprocessable("ODT mimetype entry must be valid UTF-8");
  }
}

function readOdtEntries(bytes: Uint8Array): { mimetype: string; contentXml: string } {
  const entries = readZipDirectory(bytes, "ODT");
  const mimetypeBytes = readZipEntry(bytes, entries, "mimetype", "ODT", MAX_MIMETYPE_BYTES, "ODT mimetype entry is too large");
  if (!mimetypeBytes) return unprocessable("ODT is missing mimetype entry");
  const mimetype = decodeOdtMimetype(mimetypeBytes);
  if (mimetype !== ODT_MIME) return unprocessable(`ODT mimetype entry must equal ${ODT_MIME}`);
  const contentBytes = readZipEntry(bytes, entries, "content.xml", "ODT", MAX_DOCUMENT_XML_BYTES, "ODT document text is too large");
  if (!contentBytes) return unprocessable("ODT is missing content.xml");
  return { mimetype, contentXml: decodeXml(contentBytes, "ODT") };
}

export function readOdtContentXml(bytes: Uint8Array): string {
  return readOdtEntries(bytes).contentXml;
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

function cleanXmlText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function docxXmlToText(xml: string): string {
  return cleanXmlText(decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, "\n")
      .replace(/<\/w:p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  ));
}

export function odtXmlToText(xml: string): string {
  let expandedSpaces = 0;
  const withWhitespace = xml
    .replace(/<text:s\b([^>]*)\/?\s*>/gi, (_match, attributes: string) => {
      const countMatch = attributes.match(/\btext:c\s*=\s*(["'])(\d+)\1/i);
      const count = countMatch ? Number.parseInt(countMatch[2], 10) : 1;
      if (!Number.isSafeInteger(count) || count < 1 || expandedSpaces + count > MAX_DOCUMENT_XML_BYTES) {
        return unprocessable("ODT space count is invalid");
      }
      expandedSpaces += count;
      return " ".repeat(count);
    })
    .replace(/<text:tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<text:line-break\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/text:(?:p|h)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  if (withWhitespace.length > MAX_DOCUMENT_XML_BYTES) return unprocessable("ODT document text is too large");
  return cleanXmlText(decodeXmlEntities(withWhitespace));
}

function decodeTextBytes(bytes: Uint8Array): string | null {
  let text: string;
  try {
    // Retain the BOM during decoding so stripping it is explicit and testable.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  if (text.startsWith("\ufeff")) text = text.slice(1);
  if (/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

export function textCvToText(bytes: Uint8Array): string {
  const text = decodeTextBytes(bytes);
  if (text === null) return unprocessable("TXT and Markdown CVs must be valid UTF-8 text without binary or NUL bytes");
  return text;
}

function detectZipKind(bytes: Uint8Array): "docx" | "odt" {
  const entries = readZipDirectory(bytes, "CV ZIP");
  const hasDocx = entries.some(({ name }) => name === "word/document.xml");
  const hasOdtContent = entries.some(({ name }) => name === "content.xml");
  const hasMimetype = entries.some(({ name }) => name === "mimetype");

  if (hasMimetype || hasOdtContent) {
    if (hasDocx) return unprocessable("CV ZIP archive matches more than one supported format");
    readOdtEntries(bytes);
    return "odt";
  }
  if (hasDocx) {
    readDocxDocumentXml(bytes);
    return "docx";
  }
  return unprocessable(UNSUPPORTED_FORMAT_MESSAGE);
}

export function detectCvKind(mimeType: string, bytes: Uint8Array): CvFileKind {
  let detected: CvFileKind | "text";
  if (startsWith(bytes, PDF_MAGIC)) detected = "pdf";
  else if (startsWith(bytes, JPEG_MAGIC)) detected = "jpeg";
  else if (startsWith(bytes, PNG_MAGIC)) detected = "png";
  else if (isWebp(bytes)) detected = "webp";
  else if (startsWith(bytes, ZIP_LOCAL_MAGIC)) detected = detectZipKind(bytes);
  else if (decodeTextBytes(bytes) !== null) detected = "text";
  else return unprocessable(UNSUPPORTED_FORMAT_MESSAGE);

  if (detected === "text") {
    if (mimeType === TXT_MIME) return "txt";
    if (mimeType === MARKDOWN_MIME) return "markdown";
    return unprocessable(UNSUPPORTED_FORMAT_MESSAGE);
  }

  const expectedMime: Record<Exclude<CvFileKind, "txt" | "markdown">, string> = {
    pdf: PDF_MIME,
    docx: DOCX_MIME,
    odt: ODT_MIME,
    jpeg: JPEG_MIME,
    png: PNG_MIME,
    webp: WEBP_MIME,
  };
  if (mimeType !== expectedMime[detected]) return unprocessable(UNSUPPORTED_FORMAT_MESSAGE);
  return detected;
}

export async function extractCvText(llm: LlmClient, file: { fileName: string; mimeType: string; bytes: Uint8Array }, kind: CvFileKind): Promise<string> {
  let text: string;
  if (kind === "docx") {
    text = docxXmlToText(readDocxDocumentXml(file.bytes));
  } else if (kind === "odt") {
    text = odtXmlToText(readOdtContentXml(file.bytes));
  } else if (kind === "txt" || kind === "markdown") {
    text = textCvToText(file.bytes);
  } else {
    const base64 = Buffer.from(file.bytes).toString("base64");
    const contentPart = kind === "pdf"
      ? { type: "file" as const, file: { filename: file.fileName, file_data: `data:${PDF_MIME};base64,${base64}` } }
      : { type: "image_url" as const, image_url: { url: `data:${file.mimeType};base64,${base64}` } };
    try {
      text = await llm.chat({
        model: MODELS.fast,
        temperature: 0,
        messages: [{ role: "user", content: [{ type: "text", text: TRANSCRIPTION_INSTRUCTION }, contentPart] }],
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("upstream_failed", `Could not transcribe ${kind === "pdf" ? "PDF" : "image"} CV`);
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
  return quote.length > 0 && text.includes(quote);
}
