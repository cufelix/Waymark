import { deflateRawSync } from "node:zlib";

// A tiny, deterministic ZIP builder for tests. The production reader does not
// rely on CRC values, and neither does Node's raw deflate implementation.
export function makeZip(entries: { name: string; content: string | Uint8Array; compressed?: boolean }[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content);
    const compression = entry.compressed === false ? 0 : 8;
    const payload = compression === 0 ? content : deflateRawSync(content);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compression, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, payload);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(compression, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + payload.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localParts, central, eocd]);
}

export function makeDocx(xml: string, entryName = "word/document.xml"): Uint8Array {
  return makeZip([{ name: entryName, content: xml }]);
}

export const JANE_EXAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Jane Example</w:t></w:r></w:p>
<w:p><w:r><w:t>Software Developer &amp; mentor</w:t></w:r></w:p>
<w:p><w:r><w:t>Built APIs with </w:t></w:r><w:r><w:t>TypeScript</w:t></w:r></w:p>
</w:body></w:document>`;

export const ODT_MIME = "application/vnd.oasis.opendocument.text";

export const JANE_EXAMPLE_ODT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:text>
<text:h>Jane Example</text:h>
<text:p>Software Developer<text:s text:c="2"/>&amp; mentor</text:p>
<text:p>Built APIs with<text:s/>TypeScript<text:tab/>Prague<text:line-break/>Czechia</text:p>
</office:text></office:body></office:document-content>`;

export function makeOdt(contentXml = JANE_EXAMPLE_ODT_XML, mimetype = ODT_MIME): Uint8Array {
  return makeZip([
    { name: "mimetype", content: mimetype, compressed: false },
    { name: "content.xml", content: contentXml },
  ]);
}

export function fakeImageCv(kind: "jpeg" | "png" | "webp"): Uint8Array {
  const jane = Buffer.from("Jane Example fake CV image");
  if (kind === "jpeg") return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), jane]);
  if (kind === "png") return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jane]);
  return Buffer.concat([Buffer.from("RIFF\x00\x00\x00\x00WEBP", "binary"), jane]);
}
