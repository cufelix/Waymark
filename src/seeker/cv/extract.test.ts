import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../core/errors.ts";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import { detectCvKind, docxXmlToText, extractCvDetails, extractCvText, quoteAppearsInText, readDocxDocumentXml } from "./extract.ts";
import { JANE_EXAMPLE_XML, makeDocx } from "./testdata/make-docx.ts";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("DOCX central-directory reader inflates document.xml and extracts paragraph text", async () => {
  const bytes = makeDocx(JANE_EXAMPLE_XML);
  assert.equal(detectCvKind(DOCX_MIME, bytes), "docx");
  assert.equal(readDocxDocumentXml(bytes), JANE_EXAMPLE_XML);
  assert.equal(
    await extractCvText(new FakeLlm([]), { fileName: "jane.docx", mimeType: DOCX_MIME, bytes }, "docx"),
    "Jane Example\nSoftware Developer & mentor\nBuilt APIs with TypeScript",
  );
});

test("DOCX XML text conversion decodes entities, tabs, breaks, and numeric references", () => {
  const xml = "<w:p><w:t>A &lt; B</w:t><w:tab/><w:t>&#x26; C</w:t><w:br/><w:t>&apos;yes&apos;</w:t></w:p>";
  assert.equal(docxXmlToText(xml), "A < B\t& C\n'yes'");
});

test("PDF transcription is sent as a file part using the fast model", async () => {
  const llm = new FakeLlm(["Jane Example\nTypeScript"]);
  const bytes = Buffer.from("%PDF-1.7\ntiny test payload");
  const text = await extractCvText(llm, { fileName: "jane.pdf", mimeType: "application/pdf", bytes }, "pdf");
  assert.equal(text, "Jane Example\nTypeScript");
  assert.equal(llm.calls[0].model, MODELS.fast);
  const message = llm.calls[0].messages[0];
  assert.equal(message.role, "user");
  assert.ok(Array.isArray(message.content));
  const filePart = message.content.find((part) => part.type === "file");
  assert.deepEqual(filePart, {
    type: "file",
    file: { filename: "jane.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` },
  });
});

test("extraction retries invalid JSON once then reports upstream_failed", async () => {
  const llm = new FakeLlm(["not json", '{"skills":"wrong"}']);
  await assert.rejects(extractCvDetails(llm, "TypeScript"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "upstream_failed");
    return true;
  });
  assert.equal(llm.calls.length, 2);
  assert.ok(llm.calls.every((call) => call.model === MODELS.cv && call.json === true));
  assert.match(String(llm.calls[0].messages[0].content), /Never infer, judge, rank, or score/);
});

test("quote checks normalise whitespace but remain verbatim and case-sensitive", () => {
  assert.equal(quoteAppearsInText("Built APIs with\nTypeScript", "Built APIs   with TypeScript"), true);
  assert.equal(quoteAppearsInText("Built APIs with TypeScript", "built APIs with TypeScript"), false);
});

test("a ZIP without word/document.xml is not a DOCX", () => {
  assert.throws(() => detectCvKind(DOCX_MIME, makeDocx("<x/>", "other.xml")), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "unprocessable");
    return true;
  });
});
