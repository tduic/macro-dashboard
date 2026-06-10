// Vitest config for the pure-logic unit tests in tests/.
// Kept separate from vite.config.ts (which carries dev-server / build-only
// options) so the test runner stays minimal — these are pure functions, no DOM.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
