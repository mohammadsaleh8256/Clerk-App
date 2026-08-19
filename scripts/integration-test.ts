/**
 * Integration test for the full WebSocket flow.
 *
 * Strategy: collect ALL incoming messages into a list, then poll for the one we expect.
 */

import { WebSocket } from "ws";

const SERVER_URL = "ws://localhost:3000/ws";
const API_URL = "http://localhost:3000/api";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const receivedMessages: any[] = [];

function startCollecting(ws: WebSocket) {
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      receivedMessages.push(msg);
      console.log(`  ← ${msg.type}`);
    } catch {
      // ignore
    }
  });
}

async function waitForMessage(type: string, timeoutMs = 5000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = receivedMessages.find((m) => m.type === type);
    if (found) return found;
    await sleep(50);
  }
  throw new Error(`Timeout waiting for ${type}. Received: ${receivedMessages.map((m) => m.type).join(", ")}`);
}

async function main() {
  console.log("=== Connecting display WebSocket ===");
  const ws = new WebSocket(SERVER_URL);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", (e) => reject(e));
  });

  startCollecting(ws);

  ws.send(JSON.stringify({
    type: "REGISTER",
    payload: { clientType: "display", displayId: "tv-test-1", displayName: "Test TV 1" },
  }));

  await waitForMessage("REGISTERED");
  console.log("✓ Display registered");
  await waitForMessage("SYNC_STATE");
  console.log("✓ Received SYNC_STATE");

  console.log("\n=== Creating person via REST ===");
  const person = await fetch(`${API_URL}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number: 42, name: "Test User" }),
  }).then((r) => r.json());
  console.log(`✓ Person created: id=${person.id}, number=${person.number}, name=${person.name}`);

  console.log("\n=== Calling person via REST ===");
  const callRes = await fetch(`${API_URL}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: person.id }),
  });
  const callBody = await callRes.json();
  console.log(`✓ Call request sent: HTTP ${callRes.status}`, callBody);

  console.log("\n=== Waiting for CALL_STARTED on display ===");
  const callStarted = await waitForMessage("CALL_STARTED");
  console.log(`✓ Display received CALL_STARTED: number=${callStarted.payload.queueItem.number}`);

  console.log("\n=== Display reports QUEUE_ITEM_STARTED ===");
  ws.send(JSON.stringify({
    type: "QUEUE_ITEM_STARTED",
    payload: { queueItemId: callStarted.payload.queueItem.id },
  }));
  await sleep(300);

  console.log("\n=== Display reports QUEUE_ITEM_COMPLETED ===");
  ws.send(JSON.stringify({
    type: "QUEUE_ITEM_COMPLETED",
    payload: { queueItemId: callStarted.payload.queueItem.id },
  }));
  await sleep(500);

  console.log("\n=== Checking queue state ===");
  const queue = await fetch(`${API_URL}/queue`).then((r) => r.json());
  console.log(`✓ Queue: current=${!!queue.current}, waiting=${queue.waiting.length}`);

  console.log("\n=== Checking history ===");
  const history = await fetch(`${API_URL}/history`).then((r) => r.json());
  console.log(`✓ History: ${history.items.length} items`);
  if (history.items.length > 0) {
    console.log(`  First: number=${history.items[0].number}, status=${history.items[0].status}`);
  }

  console.log("\n=== Checking displays ===");
  const displays = await fetch(`${API_URL}/displays`).then((r) => r.json());
  console.log(`✓ Displays: ${displays.length}`);
  displays.forEach((d: any) => {
    console.log(`  - ${d.id}: ${d.connected ? "🟢 connected" : "🔴 disconnected"}`);
  });

  console.log("\n=== Testing replay ===");
  receivedMessages.length = 0;
  await fetch(`${API_URL}/calls/replay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const replayCall = await waitForMessage("CALL_STARTED");
  console.log(`✓ Replay received: number=${replayCall.payload.queueItem.number}`);

  // Cleanup
  ws.close();
  console.log("\n=== ALL CHECKS PASSED ===");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
