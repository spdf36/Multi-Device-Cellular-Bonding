'use strict';
/**
 * src/MuxProtocol.js
 * Binary framing protocol matching Android's MuxProtocol.kt:
 *   Offset  Len  Field
 *      0     2   Magic    = 0x4D58 ('MX')
 *      2     1   Type
 *      3     1   Flags
 *      4     4   StreamId (uint32 BE)
 *      8     4   Length   (uint32 BE)
 *     12     N   Payload
 */

const MAGIC = 0x4D58;
const HEADER_SIZE = 12;

const FRAME_TYPE = {
  DATA: 0x00,
  SYN: 0x01,
  FIN: 0x02,
  RST: 0x03,
  PING: 0x04,
  PONG: 0x05,
  STATS: 0x06,
  AUTH: 0x07,
  AUTH_OK: 0x08,
  AUTH_FAIL: 0x09,
};

const FLAGS = {
  NONE: 0x00,
  ACK: 0x01,
  FIN: 0x02,
  SYN: 0x04,
};

function encodeFrame(type, flags, streamId, payload = Buffer.alloc(0)) {
  const buf = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
  buf.writeUInt16BE(MAGIC, 0);
  buf.writeUInt8(type, 2);
  buf.writeUInt8(flags, 3);
  buf.writeUInt32BE(streamId >>> 0, 4);
  buf.writeUInt32BE(payload.length >>> 0, 8);
  if (payload.length > 0) {
    payload.copy(buf, HEADER_SIZE);
  }
  return buf;
}

function parseFrame(buffer) {
  if (buffer.length < HEADER_SIZE) return null;
  const magic = buffer.readUInt16BE(0);
  if (magic !== MAGIC) {
    return { error: 'INVALID_MAGIC' };
  }
  const type = buffer.readUInt8(2);
  const flags = buffer.readUInt8(3);
  const streamId = buffer.readUInt32BE(4);
  const length = buffer.readUInt32BE(8);

  if (buffer.length < HEADER_SIZE + length) {
    return null; // Need more data
  }

  const payload = buffer.slice(HEADER_SIZE, HEADER_SIZE + length);
  const remaining = buffer.slice(HEADER_SIZE + length);

  return {
    frame: { type, flags, streamId, length, payload },
    remaining,
  };
}

module.exports = {
  MAGIC,
  HEADER_SIZE,
  FRAME_TYPE,
  FLAGS,
  encodeFrame,
  parseFrame,
};
