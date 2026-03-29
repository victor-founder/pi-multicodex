#!/usr/bin/env bun
/**
 * Generate JSON Schema from Zod definitions.
 * Run: bun scripts/generate-schema.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { StorageSchema } from "../storage";

const OUT_DIR = path.join(import.meta.dirname, "..", "schemas");

fs.mkdirSync(OUT_DIR, { recursive: true });

const jsonSchema = z.toJSONSchema(StorageSchema, { target: "draft-2020-12" });
const content = `${JSON.stringify(jsonSchema, null, "\t")}\n`;
const outPath = path.join(OUT_DIR, "codex-accounts.schema.json");

fs.writeFileSync(outPath, content);
console.log(`wrote ${outPath}`);
