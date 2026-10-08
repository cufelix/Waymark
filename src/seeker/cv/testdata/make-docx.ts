import { deflateRawSync } from "node:zlib";

// A tiny, deterministic ZIP builder for tests. The production reader does not
// rely on CRC values, and neither does Node's raw deflate implementation.
export function makeDocx(xml: string, entryName = "word/document.xml"): Uint8Array {
  const name = Buffer.from(entryName);
  const content = Buffer.from(xml);
  const compressed = deflateRawSync(content);

  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const centralOffset = local.length + compressed.length;
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, compressed, central, eocd]);
}

export const JANE_EXAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Jane Example</w:t></w:r></w:p>
<w:p><w:r><w:t>Software Developer &amp; mentor</w:t></w:r></w:p>
<w:p><w:r><w:t>Built APIs with </w:t></w:r><w:r><w:t>TypeScript</w:t></w:r></w:p>
</w:body></w:document>`;
