import { defineConfig } from "vite";

// fixtures/ is served as static files: /palace.json, /traces/*.json, /replays/*.jsonl
export default defineConfig({
  root: "web",
  publicDir: "../fixtures",
  server: { port: 5173, fs: { allow: [".."] } },
  build: { outDir: "../dist", emptyOutDir: true },
});
