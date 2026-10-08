import { defineConfig } from "vitest/config";

// src/seeker (Part 1) and src/gap (Part 3) run their own tests with `node --test`.
export default defineConfig({ test: { exclude: ["node_modules/**", "src/seeker/**", "src/gap/**"] } });
