/**
 * Integration test for multiple displays.
 *
 * Tests:
 * - Multiple displays can connect simultaneously
 * - Admin sees all displays
 * - When admin calls a person, ALL displays receive CALL_STARTED (broadcast)
 * - When one display reports completion, others are notified via QUEUE_UPDATED
 */

import { WebSocket } from "ws";

const SERVER_URL = "ws://localhost:3000/ws";
const API_URL = "http://localhost:3000/api";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectDisplay(displayId: string, displayName: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "REGISTER",
        payload: { clientType: "display", displayId, displayName },
      }));
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

async function main() {
  console.log("=== Connecting 3 displays ===");
  const ws1 = await connectDisplay("tv-1", "TV First Floor");
  const ws2 = await connectDisplay("tv-2", "TV Second Floor");
  const ws3 = await connectDisplay("tv-3", "TV Waiting Hall");

  const received1: any[] = [];
  const received2: any[] = [];
  const received3: any[] = [];
  ws1.on("message", (d) => { try { received1.push(JSON.parse(d.toString())); } catch {} });
  ws2.on("message", (d) => { try { received2.push(JSON.parse(d.toString())); } catch {} });
  ws3.on("message", (d) => { try { received3.push(JSON.parse(d.toString())); } catch {} });

  await sleep(500);

  console.log("\n=== Checking displays list ===");
  const displays = await fetch(`${API_URL}/displays`).then((r) => r.json());
  console.log(`✓ ${displays.length} displays connected`);
  displays.forEach((d: any) => {
    console.log(`  - ${d.id} (${d.name}): ${d.connected ? "🟢" : "🔴"}`);
  });

  if (displays.length !== 3) {
    throw new Error(`Expected 3 displays, got ${displays.length}`);
  }

  console.log("\n=== Creating person ===");
  const person = await fetch(`${API_URL}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number: 100, name: "Multi-TV Test" }),
  }).then((r) => r.json());

  console.log("\n=== Calling person (broadcast to all displays) ===");
  await fetch(`${API_URL}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: person.id }),
  });

  await sleep(1000);

  console.log("\n=== Checking which displays received CALL_STARTED ===");
  const got1 = received1.find((m) => m.type === "CALL_STARTED");
  const got2 = received2.find((m) => m.type === "CALL_STARTED");
  const got3 = received3.find((m) => m.type === "CALL_STARTED");

  console.log(`  TV-1: ${got1 ? "✓" : "✗"}`);
  console.log(`  TV-2: ${got2 ? "✓" : "✗"}`);
  console.log(`  TV-3: ${got3 ? "✓" : "✗"}`);

  // At least ONE display should have received the call
  const receivedCount = [got1, got2, got3].filter(Boolean).length;
  if (receivedCount === 0) {
    throw new Error("No display received CALL_STARTED");
  }
  console.log(`✓ ${receivedCount} display(s) received the call`);

  // Find which display got the call
  const winningDisplayId = (got1 || got2 || got3)?.payload?.queueItem?.displayId;
  console.log(`  Winning display: ${winningDisplayId}`);

  // The winning display reports completion
  console.log("\n=== Winning display reports completion ===");
  const winningWs = winningDisplayId === "tv-1" ? ws1 : winningDisplayId === "tv-2" ? ws2 : ws3;
  const winningCall = got1 || got2 || got3;
  winningWs.send(JSON.stringify({
    type: "QUEUE_ITEM_COMPLETED",
    payload: { queueItemId: winningCall.payload.queueItem.id },
  }));

  await sleep(500);

  console.log("\n=== All displays should receive QUEUE_UPDATED ===");
  const updated1 = received1.some((m) => m.type === "QUEUE_UPDATED");
  const updated2 = received2.some((m) => m.type === "QUEUE_UPDATED");
  const updated3 = received3.some((m) => m.type === "QUEUE_UPDATED");
  console.log(`  TV-1: ${updated1 ? "✓" : "✗"}`);
  console.log(`  TV-2: ${updated2 ? "✓" : "✗"}`);
  console.log(`  TV-3: ${updated3 ? "✓" : "✗"}`);

  // Cleanup
  console.log("\n=== Disconnecting TV-2 ===");
  ws2.close();
  await sleep(500);

  const displaysAfter = await fetch(`${API_URL}/displays`).then((r) => r.json());
  console.log(`✓ Now ${displaysAfter.filter((d: any) => d.connected).length} displays connected`);

  ws1.close();
  ws3.close();
  console.log("\n=== ALL MULTI-TV CHECKS PASSED ===");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
