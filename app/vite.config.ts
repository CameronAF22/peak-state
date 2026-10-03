import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the built app runs from any folder or file server, offline.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", assetsInlineLimit: 0 },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
