import { describe, expect, it } from "vitest";
import { createDecoder, encode } from "./native-messaging.ts";

describe("native messaging framing", () => {
  it("round-trips messages split across chunks", () => {
    const received: unknown[] = [];
    const decode = createDecoder((m) => received.push(m));
    const bytes = Buffer.concat([encode({ type: "ping", id: "1" }), encode({ type: "pong", id: "2" })]);

    decode(bytes.subarray(0, 3));
    decode(bytes.subarray(3, 20));
    decode(bytes.subarray(20));

    expect(received).toEqual([
      { type: "ping", id: "1" },
      { type: "pong", id: "2" },
    ]);
  });

  it("refuses messages over Chrome's 1 MB limit", () => {
    expect(() => encode({ big: "x".repeat(1024 * 1024) })).toThrow(/too large/);
  });
});
