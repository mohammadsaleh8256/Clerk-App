import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin: rename/move HTML files at the right place after build.
// Vite builds multi-page HTML keeping the input directory structure; we want them flat.
function flattenHtmlPlugin() {
  return {
    name: "flatten-html",
    apply: "build" as const,
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist/client");
      const moves: Array<[string, string]> = [
        ["src/client/admin/index.html", "admin/index.html"],
        ["src/client/display/index.html", "display/index.html"],
      ];
      for (const [from, to] of moves) {
        const src = path.join(outDir, from);
        const dest = path.join(outDir, to);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(src, dest);
        }
      }
      // Clean up empty src directory
      const srcDir = path.join(outDir, "src");
      if (fs.existsSync(srcDir)) {
        try {
          fs.rmSync(srcDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    },
  };
}

// Plugin: dev-server URL rewriting.
//
// In dev mode, Vite serves HTML entries at their source path:
//   /src/client/admin/index.html   ← what Vite actually serves
//   /admin                         ← what we want the URL to be
//
// In production, Fastify serves the built files at /admin and /display
// (because the flattenHtmlPlugin moves them there during build).
//
// To make the dev URLs match production URLs, this plugin:
//   1. Rewrites "/admin" → "/src/client/admin/index.html"
//   2. Rewrites "/display" → "/src/client/display/index.html"
//   3. Redirects "/" → "/admin" (no root HTML exists in dev)
//   4. Rewrites "/main.tsx" → "/src/client/admin/main.tsx"
//      (legacy fallback for browsers with cached old HTML that
//       still references "./main.tsx" — this prevents the 404)
//   5. Rewrites "/App.tsx" → "/src/client/admin/App.tsx" (same reason)
//
// Query strings are preserved. Static asset requests (/assets/*, /@vite/*,
// /@fs/*, /src/*, etc.) are NOT rewritten.
function devUrlRewritePlugin() {
  return {
    name: "dev-url-rewrite",
    apply: "serve" as const,
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = req.url || "";

        // Parse pathname and query separately so we can rewrite only the path
        const qIndex = url.indexOf("?");
        const pathname = qIndex >= 0 ? url.slice(0, qIndex) : url;
        const query = qIndex >= 0 ? url.slice(qIndex) : "";

        // 1. Root → redirect to /admin
        if (pathname === "/" || pathname === "") {
          res.writeHead(302, { Location: "/admin" });
          res.end();
          return;
        }

        // 2. /admin (optionally with trailing slash) → admin entry HTML
        if (pathname === "/admin" || pathname === "/admin/") {
          req.url = "/src/client/admin/index.html" + query;
        }
        // 3. /display (optionally with trailing slash) → display entry HTML
        else if (pathname === "/display" || pathname === "/display/") {
          req.url = "/src/client/display/index.html" + query;
        }
        // 4. /admin/index.html, /display/index.html → also rewrite for consistency
        else if (pathname === "/admin/index.html") {
          req.url = "/src/client/admin/index.html" + query;
        }
        else if (pathname === "/display/index.html") {
          req.url = "/src/client/display/index.html" + query;
        }
        // 5. Legacy fallback: browsers with cached old HTML may still request
        //    "/main.tsx" or "/App.tsx" (the old relative-path references).
        //    Route these to the admin entry so the page doesn't go white.
        //    The user can hard-refresh to get the new HTML.
        else if (pathname === "/main.tsx") {
          req.url = "/src/client/admin/main.tsx" + query;
        }
        else if (pathname === "/App.tsx") {
          req.url = "/src/client/admin/App.tsx" + query;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), flattenHtmlPlugin(), devUrlRewritePlugin()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@client": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        // Don't crash Vite if backend is briefly unreachable (e.g. during tsx watch restart)
        configure: (proxy) => {
          proxy.on("error", (err, req, res) => {
            // Only log once per minute to avoid spam
            const now = Date.now();
            if (!(globalThis as any)._lastProxyErrLog || now - (globalThis as any)._lastProxyErrLog > 60000) {
              (globalThis as any)._lastProxyErrLog = now;
              console.error("[VITE PROXY ERROR]", err.message);
              console.error("[VITE PROXY ERROR] Is the backend running on port 3000? Try: npm run dev:server");
            }
            if (res && !res.headersSent && typeof res.writeHead === "function") {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                code: "BACKEND_UNAVAILABLE",
                message: "Backend is not running on port 3000. Please start it with 'npm run dev:server'.",
              }));
            }
          });
        },
      },
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
      },
      "/uploads": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: path.resolve(__dirname, "src/client/admin/index.html"),
        display: path.resolve(__dirname, "src/client/display/index.html"),
      },
    },
  },
});
