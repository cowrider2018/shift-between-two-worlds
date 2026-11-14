/**
 * Write a list of files as one plain zip (the itch.io upload, built by vite.config.ts).
 *
 * No zip package: all it takes is a local header plus data per file and a central directory at the end. Compression is
 * node's own deflate, the CRC is zlib.crc32. No zip64: past 4 GB or 65535 files it throws rather than write a broken one.
 * Paths use forward slashes and keep their case (itch's server is case-sensitive). Every timestamp is 1980-01-01 00:00,
 * so the same files always make the same bytes. Files deflate does not shrink (glb, woff2) are stored as they are.
 */
import { crc32, deflateRawSync } from 'node:zlib';

/** DOS date 1980-01-01, time 00:00:00. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
/** General-purpose flag bit 11: the name is UTF-8. */
const UTF8 = 0x0800;

export interface ZipEntry {
  /** Path inside the zip: forward slashes, no leading slash. */
  name: string;
  data: Buffer;
}

export function zip(files: ZipEntry[]): Buffer {
  if (files.length >= 0xffff) throw new Error('zip: too many files (no zip64)');
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of files) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error(`zip: bad path ${name}`);
    if (data.length >= 0xffffffff) throw new Error(`zip: ${name} is too large (no zip64)`);
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const deflate = packed.length < data.length;
    const body = deflate ? packed : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8); // 8 = deflate, 0 = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory entry
    entry.writeUInt16LE(20, 4); // made by 2.0 (MS-DOS)
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42); // extra, comment, disk, attributes: all 0
    central.push(entry, nameBuf);

    offset += local.length + nameBuf.length + body.length;
    if (offset >= 0xffffffff) throw new Error('zip: archive too large (no zip64)');
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
