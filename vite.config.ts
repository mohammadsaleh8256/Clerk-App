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

export default defineConfig({
  plugins: [react(), flattenHtmlPlugin()],
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
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/uploads": {
        target: "http://localhost:3000",
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
