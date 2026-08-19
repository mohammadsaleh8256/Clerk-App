/**
 * Test server restart recovery.
 *
 * 1. Start server
 * 2. Add some items to queue (some PLAYING, some WAITING)
 * 3. Stop server abruptly
 * 4. Restart server
 * 5. Verify WAITING items are still WAITING
 * 6. Verify PLAYING items are restored to WAITING
 */

import { WebSocket } from "ws";

const API_URL = "http://localhost:3000/api";
const SERVER_URL = "ws://localhost:3000/ws";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const { execSync, spawn } = await import("node:child_process");

async function startServer() {
  const proc = spawn("node", ["dist/server/server/app.js"], {
    cwd: "/home/z/my-project",
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`${API_URL}/health`);
      if (r.ok) break;
    } catch {
      // not ready
    }
    await sleep(200);
  }
  return proc;
}

async function stopServer(proc: any) {
  try {
    process.kill(proc.pid, "SIGTERM");
  } catch {
    // ignore
  }
  await sleep(500);
}

async function connectDisplay(displayId: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "REGISTER",
        payload: { clientType: "display", displayId },
      }));
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

async function main() {
  console.log("=== Step 1: Reset DB and start server ===");
  execSync("rm -f /home/z/my-project/db/custom.db && npx prisma db push", {
    cwd: "/home/z/my-project",
    stdio: "ignore",
  });

  let serverProc = await startServer();
  console.log("✓ Server started");

  console.log("\n=== Step 2: Connect display ===");
  const ws = await connectDisplay("tv-recover-test");
  await sleep(500);
  console.log("✓ Display connected");

  console.log("\n=== Step 3: Create 3 people ===");
  const p1 = await fetch(`${API_URL}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number: 1, name: "Person 1" }),
  }).then((r) => r.json());
  const p2 = await fetch(`${API_URL}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number: 2, name: "Person 2" }),
  }).then((r) => r.json());
  const p3 = await fetch(`${API_URL}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number: 3, name: "Person 3" }),
  }).then((r) => r.json());
  console.log(`✓ Created: ${p1.id}, ${p2.id}, ${p3.id}`);

  console.log("\n=== Step 4: Call person 1 (will go PLAYING) ===");
  await fetch(`${API_URL}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: p1.id }),
  });
  await sleep(500);

  console.log("\n=== Step 5: Queue person 2 (will be WAITING) ===");
  // Person 2 can't be queued yet because person 1 is PLAYING (duplicate prevention is per-person, not per-queue)
  // Actually we can — duplicate prevention is per-person
  await fetch(`${API_URL}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: p2.id }),
  });

  console.log("\n=== Step 6: Queue person 3 (will be WAITING) ===");
  await fetch(`${API_URL}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: p3.id }),
  });

  console.log("\n=== State before crash ===");
  let queue = await fetch(`${API_URL}/queue`).then((r) => r.json());
  console.log(`  current: ${queue.current ? `${queue.current.number} (${queue.current.status})` : "null"}`);
  console.log(`  waiting: ${queue.waiting.map((q: any) => q.number).join(", ")}`);

  console.log("\n=== Step 7: Abruptly stop server (simulate crash) ===");
  ws.close();
  await stopServer(serverProc);
  console.log("✓ Server stopped");

  console.log("\n=== Step 8: Restart server ===");
  serverProc = await startServer();
  console.log("✓ Server restarted");

  console.log("\n=== Step 9: Check queue state after restart ===");
  await sleep(500);
  queue = await fetch(`${API_URL}/queue`).then((r) => r.json());
  console.log(`  current: ${queue.current ? `${queue.current.number} (${queue.current.status})` : "null"}`);
  console.log(`  waiting: ${queue.waiting.map((q: any) => q.number).join(", ")}`);

  // Expectations:
  // - All items should be in WAITING state (PLAYING was restored to WAITING)
  // - Order should be preserved: 1 (oldest), 2, 3
  if (queue.current !== null) {
    throw new Error(`Expected no current item, got ${queue.current.number}`);
  }
  if (queue.waiting.length !== 3) {
    throw new Error(`Expected 3 waiting items, got ${queue.waiting.length}`);
  }
  const numbers = queue.waiting.map((q: any) => q.number);
  if (numbers[0] !== 1 || numbers[1] !== 2 || numbers[2] !== 3) {
    throw new Error(`Order wrong: ${numbers.join(", ")}`);
  }
  console.log("\n✓ Recovery successful — all items in WAITING state in correct order");

  await stopServer(serverProc);
  console.log("\n=== RECOVERY TEST PASSED ===");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
