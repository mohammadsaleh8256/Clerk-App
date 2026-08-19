import { describe, it, expect } from "vitest";
import { config } from "../src/server/config/index.js";
import { resolveAudioPath, saveAudioFile, deleteAudioFile } from "../src/server/storage/audioStorage.js";
import fs from "node:fs";
import path from "node:path";

describe("AudioStorage security", () => {
  it("should reject path traversal attempts", () => {
    expect(() => resolveAudioPath("../../etc/passwd")).toThrow();
    expect(() => resolveAudioPath("..\\..\\windows\\system32")).toThrow();
    expect(() => resolveAudioPath("../../../etc/shadow")).toThrow();
    expect(() => resolveAudioPath("/etc/passwd")).toThrow();
    expect(() => resolveAudioPath("")).toThrow();
  });

  it("should accept valid filenames inside uploads dir", () => {
    const abs = resolveAudioPath("test-abc.mp3");
    expect(abs.startsWith(config.uploadsDir)).toBe(true);
  });

  it("should reject non-allowed file extensions", () => {
    expect(() =>
      saveAudioFile({
        originalName: "evil.exe",
        mime: "application/octet-stream",
        buffer: Buffer.from("test"),
      }),
    ).toThrow();
    expect(() =>
      saveAudioFile({
        originalName: "evil.php",
        mime: "application/x-php",
        buffer: Buffer.from("test"),
      }),
    ).toThrow();
  });

  it("should reject empty file", () => {
    expect(() =>
      saveAudioFile({
        originalName: "empty.mp3",
        mime: "audio/mpeg",
        buffer: Buffer.alloc(0),
      }),
    ).toThrow();
  });

  it("should reject file over max size", () => {
    const big = Buffer.alloc(config.maxAudioSize + 1);
    expect(() =>
      saveAudioFile({
        originalName: "big.mp3",
        mime: "audio/mpeg",
        buffer: big,
      }),
    ).toThrow();
  });

  it("should save valid file and return safe random name", () => {
    const stored = saveAudioFile({
      originalName: "valid.mp3",
      mime: "audio/mpeg",
      buffer: Buffer.from("ID3 fake mp3 content"),
    });
    expect(stored.relativePath).toMatch(/^[a-f0-9]{16}\.mp3$/);
    expect(fs.existsSync(stored.absolutePath)).toBe(true);
    expect(stored.url).toBe(`/uploads/audio/${stored.relativePath}`);
    // Cleanup
    deleteAudioFile(stored.relativePath);
  });

  it("should delete previous file when new one is saved", () => {
    const stored1 = saveAudioFile({
      originalName: "v1.mp3",
      mime: "audio/mpeg",
      buffer: Buffer.from("v1"),
    });
    const stored2 = saveAudioFile({
      originalName: "v2.mp3",
      mime: "audio/mpeg",
      buffer: Buffer.from("v2"),
      previousRelativePath: stored1.relativePath,
    });
    // First file should be deleted
    expect(fs.existsSync(stored1.absolutePath)).toBe(false);
    // Second file should exist
    expect(fs.existsSync(stored2.absolutePath)).toBe(true);
    deleteAudioFile(stored2.relativePath);
  });
});
