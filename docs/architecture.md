# Architecture

pi-Forge is an agent harness that builds agent harnesses. It and every harness it builds run on the same small core, on top of [pi](https://github.com/earendil-works/pi).

## Principles

1. **Depend on pi, don't fork it.** pi (`@earendil-works/pi-coding-agent`) is a pinned npm dependency. All customization goes through pi's extension points: packages, extensions, skills, themes and settings. Upgrading pi is `npm run upgrade -- --pi <version> --apply`.
2. **The spec is the source of truth.** Each harness has a `harness.yaml`. The generator writes everything else from it and from `templates/`. Generated files are hashed in `.forge/manifest.json`, so a hand edit is detected and never silently overwritten.
3. **`custom/` is the only hand-written code.** Tools, helpers, custom views, skills and the logo live there. The generator never touches it.
4. **pi-Forge is a harness like any other.** `forge/` has the same layout as `harnesses/<name>/`. Its domain is building harnesses.
5. **Tools stay UI-free.** A tool returns data plus a view id. Each front end (browser, terminal, JSON) decides how to draw it.

## Overview

```
  you ──► pi-Forge (forge/)
            skills: harness-interview, harness-update, tool-builder, view-builder
            tools:  forge_ask, forge_init, forge_validate, forge_generate, forge_smoke,
                    forge_check_view, forge_promote_view, forge_package, forge_list
            │ writes
            ▼
          harnesses/<name>/harness.yaml + custom/
            │ forge_generate  (packages/forge-gen + templates/)
            ▼
          harnesses/<name>/   a pi package + launcher (bin/<name>.ts)
            │
     ┌──────┼───────────────────────┬──────────────────────────┐
     ▼      ▼                       ▼                          ▼
  terminal  -p / --mode json / rpc  web (browser UI)     standalone program
  (pi TUI)  (headless)              packages/harness-web  (npm run package, Bun)
```

## Packages

| Package | Role |
|---|---|
| `packages/harness-spec` | The `harness.yaml` schema (TypeBox), `loadSpec`, and `validateSpec` (structural errors with exact paths, plus semantic checks: unknown views, tools without a view, missing logo). `npm run schema` exports `schema/harness.schema.json` for editor completion. |
| `packages/harness-core` | `runHarness(dir, args)`. It loads the spec, applies saved provider keys, and syncs `~/.forge/<name>/settings.json` (model, theme, tools, and the harness folder as a pi package). Then it starts the web UI or hands off to pi's `main(args)` for every other mode. `runPackagedHarness()` is the entry point of packaged programs. |
| `packages/harness-web` | The browser UI. A Node HTTP server on `127.0.0.1` runs the harness in `--mode rpc` and relays it to the page: server-sent events go to the browser, and POST `/api/rpc` comes back. The page is plain JS (`public/`), with no build step. It also serves view renderers, chats, and Settings (provider keys). |
| `packages/forge-gen` | The generator (`planHarness` / `applyPlan`), smoke tests (`loadCheck`, `liveCheck`), the view checker, and the packager (`pack.ts`). |

## What a generated harness contains

```
harnesses/<name>/
  harness.yaml            the spec (yours)
  custom/                 yours: extensions/ (tools), lib/, views/, skills/, brand/mark.svg
  .forge/manifest.json    hashes of generated files
  bin/<name>.ts           launcher → runHarness()
  package.json            marks the folder as a pi package
  APPEND_SYSTEM.md        system prompt (spec prompt + plan and view guidance)
  themes/                 terminal theme from ui.theme
  extensions/forge-*.ts   header, guards, views, plan tool
  forge_modules/          copies of the templates the harness uses
```

Each harness keeps its settings, chats and pi credentials in `~/.forge/<name>/` (`PI_CODING_AGENT_DIR`), separate from `~/.pi` and from other harnesses. Provider keys entered in Settings go in `~/.forge/credentials.json` and apply to every harness.

## Views

A tool returns `viewResult(text, viewId, data)`, which comes out as `content: text` and `details: { view, data }`.

```
agent calls  molecule_lookup("caffeine")
        │
result.content:  "Caffeine C8H10N4O2, MW 194.19 ..."     ← what the model reads
result.details:  { view: "molecule", data: { cid, name, smiles, sdf3d, ... } }
        │
        ├──► terminal:  views/molecule/tui.ts   (text: summarize + renderTui)
        ├──► json/rpc:  raw details in tool_execution_end
        └──► browser:   views/molecule/web.js   render(el, data, ctx) → 3Dmol viewer
```

A view folder has `view.json` (metadata), `types.ts`, `tui.ts`, `web.js` and `sample.json`. Shared views live in `templates/views/`, and harness-specific ones in `custom/views/`. `forge_check_view` renders the sample at several widths. `forge_promote_view` moves a custom view into `templates/` so every harness can use it. In the spec, `ui.views[].shows` maps tools to a view, and `panel: right` keeps the latest result pinned in the side card.

## Plans

Every harness has an `update_plan` tool (`templates/plan/plan.ts`). It returns a `plan` view. The browser shows the latest plan in the side card with ticked steps, and the terminal shows it as a widget above the input.

## Guards

`guards:` in the spec become a `tool_call` hook (`templates/guards/guards.ts`):
- `protected_paths`: globs that `write` and `edit` may not touch without your OK.
- `confirm_bash`: substrings that make a shell command need your OK.

With a UI (terminal or browser) you are asked. In headless modes, with no one to ask, the call is blocked.

## Packaging

`npm run package -- harnesses/<name> [--target <bun-target>]` builds `dist/<name>-<target>/`. The folder holds:
- a Bun-compiled executable (pi + harness-core + harness-web)
- the pi assets pi reads at runtime (themes, export templates, the photon wasm)
- the web UI files
- a copy of the harness folder, since extensions are still loaded by pi at runtime
- launchers, a README, and the license notices

Inside the binary, pi supplies its own modules to extensions, so the harness needs no `node_modules`.

## pi features used

| Need | pi feature |
|---|---|
| One CLI, every mode | `main(args)`: TUI, `-p`, `--mode json`, `--mode rpc` |
| Separate config per harness | `PI_CODING_AGENT_DIR` |
| Harness as a unit | pi packages (`settings.packages`) |
| Tools | `pi.registerTool()` with TypeBox parameters |
| Guardrails | the `tool_call` event |
| Questions | `ctx.ui.select/confirm/input/editor`, which work in the TUI and over RPC (the web UI answers `extension_ui_request`) |
| Terminal look | themes, `setHeader`, `setWidget`, `setTitle` |
| Skills | Agent Skills (`SKILL.md`), loaded on demand |
| System prompt | `APPEND_SYSTEM.md` in the agent dir |

Limits worth knowing:
- Terminal images only work in kitty and iTerm2, so rich views need the browser, and the terminal shows a text version.
- RPC doesn't forward custom terminal components, so the web UI draws views itself from `details`.
