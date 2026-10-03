// Vite serves the three light-and-text design prototypes (D-onboarding-019).
// `npm run design -w @peak-state/onboarding` serves design/ on port 5175; open /orb/, /horizon/ or /constellation/.
// Each prototype imports the same engine, hints, playback and voice modules from ../src as the harness.

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const port = Number(process.env.DESIGN_PORT ?? 5175);

export default defineConfig({
  root: here,
  publicDir: false,
  server: { host: "127.0.0.1", port, strictPort: true, fs: { allow: [here, pkgRoot, repoRoot] } },
  preview: { host: "127.0.0.1", port, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL("../dist-design", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        orb: fileURLToPath(new URL("./orb/index.html", import.meta.url)),
        horizon: fileURLToPath(new URL("./horizon/index.html", import.meta.url)),
        constellation: fileURLToPath(new URL("./constellation/index.html", import.meta.url)),
      },
    },
  },
});
