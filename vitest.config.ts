import { defineConfig } from "vitest/config";

// src/seeker (Part 1), src/gap (Part 3) and src/roadmap (Part 4) run their own tests with `node --test`.
export default defineConfig({ test: { exclude: ["node_modules/**", "src/seeker/**", "src/gap/**", "src/roadmap/**"] } });
