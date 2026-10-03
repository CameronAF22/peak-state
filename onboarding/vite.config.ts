// Vite serves and builds the question harness page (D-onboarding-012).
// `npm run harness` runs `vite --host 127.0.0.1 --port 5174`; with root at harness/ the printed URL opens the page.
// The page's entry (harness/main.ts) imports from ../src, which Vite serves through fs.allow.
// /api/live/session starts GPT live sessions with the server-held key (D-onboarding-020, harness/live-proxy.ts).

import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { createLiveProxy } from "./harness/live-proxy.ts";

function liveProxyPlugin(): Plugin {
  return {
    name: "peak-live-proxy",
    configureServer(server) {
      server.middlewares.use(createLiveProxy());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createLiveProxy());
    },
  };
}

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./harness", import.meta.url)),
  publicDir: false,
  plugins: [liveProxyPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: { allow: [here, repoRoot] },
  },
  preview: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL("./dist-harness", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
  },
});
