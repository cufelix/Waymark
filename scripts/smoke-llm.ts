// One cheap real call through OpenRouter, recorded in the cost ledger.
import { z } from "zod";
import { chatJson } from "../src/llm";
import { pool } from "../src/db/pool";

const r = await chatJson(z.object({ skill: z.string() }), "You extract skills.", 'Text: "I build Docker images daily." Return {"skill":"<the skill>"}');
process.stdout.write(JSON.stringify(r) + "\n");
await pool.end();
