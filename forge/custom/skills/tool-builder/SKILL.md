---
name: tool-builder
description: Write a custom agent tool for a pi-Forge harness (API client, CLI wrapper, file processor) in custom/extensions, returning data for the harness's views. Use when a harness needs a tool listed in tools.custom that does not exist yet, or a tool must be fixed.
---

# Build a custom tool

Tools live in `harnesses/<name>/custom/extensions/<topic>-tools.ts` (one file can hold several tools). Helpers go in `custom/lib/`.

## Start from a template
- HTTP/JSON API: `templates/tools/http-json-api.ts`
- Command-line program: `templates/tools/cli-command.ts`
Copy it to `custom/extensions/`, then adapt. The imports in the templates are already correct for that location.

## Rules
- **Schema**: `Type.Object({...})` from `@earendil-works/pi-ai`, each field with a `description`. Use `StringEnum([...] as const)` for choices. Optional fields with defaults stated in the description.
- **Description**: what it does + when to use it, in one or two sentences. The model chooses tools from this text.
- **Result**: `return viewResult(text, viewId, data)` from `../../forge_modules/views/registry.ts`.
  - `text`: what the model needs to reason (compact; never dump megabytes: truncate and say so).
  - `data`: must match `forge_modules/views/<viewId>/types.ts` (import the type and annotate it).
- **Register** with `pi.registerTool(withViews(tool))` so results render as views. No UI code in tools.
- **Errors**: `throw new Error("clear message")` for failures; the model sees it and can recover.
- **Network**: `fetch` with the `signal` argument and a timeout (`AbortSignal.timeout(20_000)` when no signal).
- **Keys and settings**: declare every key, account ID, region or program path the tool needs under `credentials:` in
  harness.yaml (see the `harness-interview` skill for the format). Then read it with
  `import { getKey, requireKey } from "../../forge_modules/keys.ts";`:
  `requireKey("SHOPIFY_ACCESS_TOKEN")` returns the value or throws a message telling the user where to add it
  (Settings → <Title> keys, `/keys`, or the environment variable); `getKey("BLENDER_PATH")` for optional ones.
  Call them inside `execute` (not at import time), so a key added later works without a restart.
  Never hardcode, log, or return key values. `forge_validate` warns about any `process.env.X` that isn't declared.
- **Annotations**: `{ readOnlyHint: true }` for tools that only read; `{ destructiveHint: true }` for anything that deletes or sends.
- **Names**: snake_case verb_noun, matching `tools.custom` in harness.yaml.

## Check
1. Add the tool name to `tools.custom` (and to a view's `shows` if it returns a view).
2. `forge_validate`, `forge_generate` with apply, `forge_smoke` (load check catches syntax/import errors with file:line).
3. `forge_smoke` with a prompt that makes the model call the tool; confirm the view in the result.
