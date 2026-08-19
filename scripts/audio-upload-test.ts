/**
 * Test audio upload via REST API.
 */

import fs from "node:fs";
import path from "node:path";

const API_URL = "http://localhost:3000/api";

// Minimal valid MP3 file (ID3 header + a few bytes of fake audio data)
const MINIMAL_MP3 = Buffer.concat([
  Buffer.from("ID3"),                  // ID3v2 header
  Buffer.from([0x03, 0x00]),           // version 2.3
  Buffer.from([0x00]),                 // flags
  Buffer.from([0x00, 0x00, 0x00, 0x20]), // size (32 bytes)
  Buffer.alloc(32, 0),                 // padding
  Buffer.from("FRAME"),                // fake frame header
  Buffer.alloc(100, 0),                // fake audio data
]);

async function main() {
  console.log("=== Creating person ===");
  const person = await fetch(`${API_URL}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number: 1, name: "Audio Test" }),
  }).then((r) => r.json());
  console.log(`✓ Person created: id=${person.id}`);

  console.log("\n=== Uploading MP3 file ===");
  const form = new FormData();
  const blob = new Blob([MINIMAL_MP3], { type: "audio/mpeg" });
  form.append("file", blob, "test.mp3");

  const uploadRes = await fetch(`${API_URL}/people/${person.id}/audio`, {
    method: "POST",
    body: form,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.json();
    throw new Error(`Upload failed: ${uploadRes.status} ${JSON.stringify(err)}`);
  }
  const uploaded = await uploadRes.json();
  console.log(`✓ Audio uploaded`);
  console.log(`  audioFile: ${uploaded.audioFile}`);
  console.log(`  audioUrl: ${uploaded.audioUrl}`);
  console.log(`  hasAudio: ${uploaded.hasAudio}`);

  console.log("\n=== Downloading audio file ===");
  const dlRes = await fetch(`http://localhost:3000${uploaded.audioUrl}`);
  console.log(`  HTTP ${dlRes.status}, Content-Type: ${dlRes.headers.get("content-type")}, Content-Length: ${dlRes.headers.get("content-length")}`);
  if (!dlRes.ok) {
    throw new Error(`Download failed: ${dlRes.status}`);
  }
  console.log("✓ Audio file is accessible");

  console.log("\n=== Trying to upload EXE file (should be rejected) ===");
  const exeForm = new FormData();
  const exeBlob = new Blob([Buffer.from("MZ...executable")], { type: "application/octet-stream" });
  exeForm.append("file", exeBlob, "evil.exe");
  const exeRes = await fetch(`${API_URL}/people/${person.id}/audio`, {
    method: "POST",
    body: exeForm,
  });
  console.log(`  HTTP ${exeRes.status} (expected 400 or 415)`);
  if (exeRes.ok) {
    throw new Error("EXE upload should have been rejected");
  }
  console.log("✓ EXE upload correctly rejected");

  console.log("\n=== Trying path traversal in download (should be rejected) ===");
  const traversalRes = await fetch(`http://localhost:3000/uploads/audio/../../etc/passwd`);
  console.log(`  HTTP ${traversalRes.status} (expected 403 or 404)`);
  if (traversalRes.ok) {
    throw new Error("Path traversal should have been rejected");
  }
  console.log("✓ Path traversal correctly blocked");

  console.log("\n=== Replacing audio with new file ===");
  const newForm = new FormData();
  const newBlob = new Blob([MINIMAL_MP3], { type: "audio/mpeg" });
  newForm.append("file", newBlob, "replacement.mp3");
  const replaceRes = await fetch(`${API_URL}/people/${person.id}/audio`, {
    method: "POST",
    body: newForm,
  });
  if (!replaceRes.ok) {
    throw new Error(`Replace failed: ${replaceRes.status}`);
  }
  const replaced = await replaceRes.json();
  console.log(`✓ New audio: ${replaced.audioFile}`);
  console.log(`  Old audio (${uploaded.audioFile}) should be deleted from disk`);

  console.log("\n=== Deleting audio ===");
  const delRes = await fetch(`${API_URL}/people/${person.id}/audio`, {
    method: "DELETE",
  });
  if (!delRes.ok) {
    throw new Error(`Delete failed: ${delRes.status}`);
  }
  const deleted = await delRes.json();
  console.log(`✓ Audio deleted, hasAudio: ${deleted.hasAudio}`);

  console.log("\n=== ALL AUDIO UPLOAD CHECKS PASSED ===");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
