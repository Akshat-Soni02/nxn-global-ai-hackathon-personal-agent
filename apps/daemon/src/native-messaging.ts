// Chrome native messaging framing: each message is a 4-byte little-endian length followed by UTF-8 JSON.
// https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
import type { Readable, Writable } from "node:stream";

// Chrome rejects messages from the host larger than 1 MB.
export const MAX_HOST_MESSAGE_BYTES = 1024 * 1024;

export function encode(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  if (json.length > MAX_HOST_MESSAGE_BYTES) {
    throw new Error(`native message too large: ${json.length} bytes`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

// Splits a byte stream into decoded messages. Handles messages split across chunks.
export function createDecoder(onMessage: (message: unknown) => void) {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      onMessage(JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")));
      buffer = buffer.subarray(4 + length);
    }
  };
}

export function connect(input: Readable, output: Writable, onMessage: (message: unknown) => void) {
  input.on("data", createDecoder(onMessage));
  return { send: (message: unknown) => output.write(encode(message)) };
}
