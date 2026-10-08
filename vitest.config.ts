import { defineConfig } from "vitest/config";

// src/seeker (Part 1) runs its own tests with `node --test`, see src/seeker/README.md.
export default defineConfig({ test: { exclude: ["node_modules/**", "src/seeker/**"] } });
