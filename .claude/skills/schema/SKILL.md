---
name: schema
description: Run schema:commit after any src/schemas/*.ts change. Regenerates metadata, verifies counts, runs tests, and stages generated files. Required after every schema change to prevent metadata drift (the #1 CI failure cause).
disable-model-invocation: true
---

Run `npm run schema:commit` in the project directory.

This regenerates 5 files: `action-counts.ts`, `annotations.ts`, `completions.ts`, `server.json`, `package.json`

Then verify the output shows:
- No metadata drift
- Tool count = 22
- Action count matches `src/schemas/index.ts:63`

If it fails, report the specific error. Common causes:
- TypeScript error in the schema file just edited
- Zod discriminated union missing a new action
- SPECIAL_CASE_TOOLS count mismatch in `scripts/generate-metadata.ts`
