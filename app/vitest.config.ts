// Tests run on Vitest's own Vite, kept apart from vite.config.ts (which uses Vite 8 and the React plugin).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
