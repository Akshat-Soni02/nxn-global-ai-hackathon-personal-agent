import { describe, expect, it } from "vitest";
import { kindOf, matchesAccept, wrongKind } from "./accept.ts";

describe("which files a step takes", () => {
  it("reads the HTML accept syntax: extensions, a whole family, an exact type", () => {
    expect(matchesAccept("/Users/me/IMG_0001.JPG", ".jpg,.jpeg")).toBe(true);
    expect(matchesAccept("/Users/me/IMG_0001.jpeg", ".jpg")).toBe(true); // the same type by another extension
    expect(matchesAccept("/Users/me/IMG_0001.heic", "image/*")).toBe(true);
    expect(matchesAccept("/Users/me/scan.png", "application/pdf, image/png")).toBe(true);
    expect(matchesAccept("/Users/me/backup.tar.gz", ".tar.gz")).toBe(true);
    expect(matchesAccept("/Users/me/report.pdf", "image/*")).toBe(false);
    expect(matchesAccept("/Users/me/notes.xyz", "image/*")).toBe(false); // an unknown type is no image
  });

  it("takes anything when there is no rule", () => {
    expect(matchesAccept("/Users/me/anything.xyz", undefined)).toBe(true);
    expect(matchesAccept("/Users/me/anything.xyz", " ")).toBe(true);
    expect(matchesAccept("/Users/me/anything.xyz", "*/*")).toBe(true);
  });

  it("makes the rule from the file you recorded with: any image for a photo, the same extension otherwise", () => {
    expect(kindOf("Rushil Photo.jpeg")).toBe("image/*");
    expect(kindOf("clip.mov")).toBe("video/*");
    expect(kindOf("voice.m4a")).toBe("audio/*");
    expect(kindOf("invoice-0923.pdf")).toBe(".pdf");
    expect(kindOf("page.HTML")).toBe(".htm,.html");
    expect(kindOf("data.parquet")).toBe(".parquet");
    expect(kindOf("odd.raw3", "image/x-raw")).toBe("image/*,.raw3"); // the page said what it was
    expect(kindOf("README")).toBeUndefined();
  });

  it("always takes the next file like the one you recorded with", () => {
    const recorded: [string, string?][] = [
      ["IMG_0001.jpeg"],
      ["IMG_0001.DNG", "image/x-adobe-dng"],
      ["frame.raw3", "image/x-raw"],
      ["clip.mov", "video/quicktime"],
      ["invoice-0923.pdf", "application/pdf"],
      ["data.parquet", ""],
    ];
    for (const [name, mime] of recorded) {
      const next = name.replace(/^[^.]+/, "next-one");
      expect(matchesAccept(next, kindOf(name, mime)), `${next} after ${name}`).toBe(true);
    }
  });

  it("says what was wrong in words", () => {
    expect(wrongKind("/Users/me/report.pdf", "image/*")).toBe(
      "report.pdf is the wrong kind of file: this step takes images",
    );
    expect(wrongKind("/Users/me/a.png", ".pdf,audio/*")).toBe(
      "a.png is the wrong kind of file: this step takes .pdf files or audio files",
    );
    expect(wrongKind("/Users/me/a.png", "application/pdf")).toBe(
      "a.png is the wrong kind of file: this step takes .pdf files",
    );
    expect(wrongKind("/Users/me/a.png", "image/*")).toBeUndefined();
  });
});
