import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../core/errors.ts";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import {
  SUPPORTED_CV_FORMATS,
  detectCvKind,
  docxXmlToText,
  extractCvDetails,
  extractCvText,
  odtXmlToText,
  quoteAppearsInText,
  readDocxDocumentXml,
  readOdtContentXml,
  textCvToText,
} from "./extract.ts";
import { JANE_EXAMPLE_ODT_XML, JANE_EXAMPLE_XML, ODT_MIME, fakeImageCv, makeDocx, makeOdt } from "./testdata/make-docx.ts";

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

test("supported CV formats expose MIME and display labels", () => {
  assert.deepEqual(SUPPORTED_CV_FORMATS, [
    { mime: "application/pdf", label: "PDF" },
    { mime: DOCX_MIME, label: "DOCX" },
    { mime: "text/plain", label: "TXT" },
    { mime: "text/markdown", label: "Markdown" },
    { mime: ODT_MIME, label: "ODT" },
    { mime: "image/jpeg", label: "JPEG" },
    { mime: "image/png", label: "PNG" },
    { mime: "image/webp", label: "WebP" },
  ]);
});

test("TXT and Markdown are detected from valid UTF-8 content and a TXT BOM is stripped", async () => {
  const txt = Buffer.from("\ufeffJane Example\nBuilt APIs with TypeScript");
  const markdown = Buffer.from("# Jane Example\n\nBuilt APIs with TypeScript");
  assert.equal(detectCvKind("text/plain", txt), "txt");
  assert.equal(detectCvKind("text/markdown", markdown), "markdown");
  assert.equal(textCvToText(txt), "Jane Example\nBuilt APIs with TypeScript");
  assert.equal(await extractCvText(new FakeLlm([]), { fileName: "jane.txt", mimeType: "text/plain", bytes: txt }, "txt"), "Jane Example\nBuilt APIs with TypeScript");
});

test("ODT reader validates its mimetype and handles paragraphs, headings, spaces, tabs, line breaks, and entities", async () => {
  const bytes = makeOdt();
  assert.equal(detectCvKind(ODT_MIME, bytes), "odt");
  assert.equal(readOdtContentXml(bytes), JANE_EXAMPLE_ODT_XML);
  const expected = "Jane Example\nSoftware Developer  & mentor\nBuilt APIs with TypeScript\tPrague\nCzechia";
  assert.equal(odtXmlToText(JANE_EXAMPLE_ODT_XML), expected);
  assert.equal(await extractCvText(new FakeLlm([]), { fileName: "jane.odt", mimeType: ODT_MIME, bytes }, "odt"), expected);
});

test("ODT space expansion is capped across the whole document", () => {
  const xml = '<text:p><text:s text:c="10485760"/><text:s text:c="10485761"/></text:p>';
  assert.throws(() => odtXmlToText(xml), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "unprocessable");
    assert.match(error.message, /space count/);
    return true;
  });
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

test("image transcription sends an image_url data URI using the fast model and the PDF instruction", async () => {
  const imageLlm = new FakeLlm(["Jane Example\nTypeScript"]);
  const bytes = fakeImageCv("png");
  assert.equal(detectCvKind("image/png", bytes), "png");
  assert.equal(await extractCvText(imageLlm, { fileName: "jane.png", mimeType: "image/png", bytes }, "png"), "Jane Example\nTypeScript");
  assert.equal(imageLlm.calls[0].model, MODELS.fast);
  const message = imageLlm.calls[0].messages[0];
  assert.equal(message.role, "user");
  assert.ok(Array.isArray(message.content));
  assert.deepEqual(message.content.find((part) => part.type === "image_url"), {
    type: "image_url",
    image_url: { url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` },
  });

  const pdfLlm = new FakeLlm(["Jane Example"]);
  await extractCvText(pdfLlm, { fileName: "jane.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF fake Jane Example") }, "pdf");
  const pdfMessage = pdfLlm.calls[0].messages[0];
  assert.equal(pdfMessage.role, "user");
  assert.ok(Array.isArray(pdfMessage.content));
  assert.deepEqual(message.content[0], pdfMessage.content[0]);
});

test("JPEG, PNG, and WebP are identified by magic bytes", () => {
  assert.equal(detectCvKind("image/jpeg", fakeImageCv("jpeg")), "jpeg");
  assert.equal(detectCvKind("image/png", fakeImageCv("png")), "png");
  assert.equal(detectCvKind("image/webp", fakeImageCv("webp")), "webp");
});

test("binary or NUL-containing content is rejected as TXT", () => {
  assert.throws(() => detectCvKind("text/plain", Buffer.from([0x4a, 0x61, 0x6e, 0x65, 0x00, 0xff])), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "unprocessable");
    return true;
  });
});

test("ODT with a wrong mimetype entry is rejected", () => {
  assert.throws(() => detectCvKind(ODT_MIME, makeOdt(JANE_EXAMPLE_ODT_XML, "application/zip")), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "unprocessable");
    assert.match(error.message, /mimetype entry must equal/);
    return true;
  });
});

test("detected format must match the supplied MIME", () => {
  for (const [mimeType, bytes] of [
    ["text/plain", Buffer.from("%PDF-1.7 Jane Example")],
    ["image/png", fakeImageCv("jpeg")],
    ["application/pdf", makeOdt()],
  ] as const) {
    assert.throws(() => detectCvKind(mimeType, bytes), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "unprocessable");
      for (const format of ["PDF", "DOCX", "TXT", "Markdown", "ODT", "JPEG", "PNG", "WebP"]) {
        assert.match(error.message, new RegExp(format));
      }
      return true;
    });
  }
});

test("an empty image transcription is unprocessable", async () => {
  await assert.rejects(
    extractCvText(new FakeLlm([" \n "]), { fileName: "jane.webp", mimeType: "image/webp", bytes: fakeImageCv("webp") }, "webp"),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "unprocessable");
      return true;
    },
  );
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

test("quote checks require an exact verbatim, case-sensitive match", () => {
  assert.equal(quoteAppearsInText("Built APIs with\nTypeScript", "Built APIs with TypeScript"), false);
  assert.equal(quoteAppearsInText("Built APIs with TypeScript", "Built APIs with TypeScript"), true);
  assert.equal(quoteAppearsInText("Built APIs with TypeScript", "built APIs with TypeScript"), false);
});

test("a ZIP without word/document.xml is not a DOCX", () => {
  assert.throws(() => detectCvKind(DOCX_MIME, makeDocx("<x/>", "other.xml")), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "unprocessable");
    return true;
  });
});
