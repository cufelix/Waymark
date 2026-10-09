import { defineConfig } from "vitest/config";

// Parts 1, 3 and 4 use node:test and run separately through `pnpm test:node`.
export default defineConfig({
  test: { exclude: ["node_modules/**", "src/log.test.ts", "src/seeker/**", "src/gap/**", "src/roadmap/**"] },
});
