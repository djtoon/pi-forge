---
name: harness-interview
description: Interview the user about their work and build a new custom agent harness for it (tools, prompts, guardrails, theme, domain views, headless use). Use when the user wants a new harness, agent, or assistant for a domain ("make me a harness for X", "build an agent for my Y work").
---

# Harness interview

Goal: a working harness in `harnesses/<name>/` that fits the user's actual work, built from a `harness.yaml` they understood and approved. Ask only what changes the harness; use defaults for everything else.

## 0. Look first
- `forge_list` (harnesses) and `forge_list` with `what: views`: know what exists before suggesting anything.
- If a harness for the same domain exists, offer to update it instead (use the `harness-update` skill).

## 1. Interview with `forge_ask`
Ask in rounds of 2-5 questions. Options first, recommended option first, free text only for names/descriptions/URLs.
Every question with options also takes a typed answer, and `forge_ask` adds an open "anything else?" question at the end
of each round by itself: don't add your own, but read that answer and act on it. A "(skipped…)" answer means: use your recommended default.
If `forge_ask` fails (headless mode), ask the same questions in your reply and stop until the user answers.

**Round 1: the work**
- domain (free text: "What kind of work is this harness for?")
- main tasks (multi: suggest 4-6 concrete tasks for that domain, from your own knowledge)
- who uses it (just me / my team / automation, headless)

**Round 2: the toolkit** (the most important round: a harness is only as good as its tools)
Before asking, design the full specialist toolkit yourself from the domain and the tasks: everything the agent may need
to make the output excellent. Cover every category that applies:
- **Sources**: real domain data and APIs, so it never works from memory
- **Makers**: tools that produce the actual artifact in the formats the user needs
- **Checkers**: validators, simulators, rule and compliance checks run before showing the result
- **Calculators and converters**: domain math, units, estimates, costs
- **Previewers**: something to see each important result (pairs with Round 4)
- **Improvers**: compare versions, score against criteria, refine
- **Exporters and integrations**: hand the result to the next step
Aim for roughly 6-15 tools. Then ask:
- the proposed toolkit (multi, all pre-described as `name — what it does`, recommended ones first): the user unticks what they don't want, and "Other" adds tools
- data sources and APIs the tools should use (multi: real, public or common ones for the domain; "Other" for internal APIs)
- built-in tools (single: "full: read, write, edit, bash, grep, find, ls" recommended / "read-only: read, grep, find, ls" / "none")
- Keys and settings: for each API or account the tools use, decide yourself what it needs (an API key, an account or
  property ID, a region, a path to a program) and confirm the list with the user (multi, pre-ticked). These become
  `credentials:` in the spec, so the user enters them in the harness's Settings page (or `/keys` in the terminal).
  **Never ask for the values themselves**, in a question or in chat.
- Programs the tools could use if installed (e.g. a slicer, ffmpeg, a CAD kernel): check with `bash` whether they exist and say what each unlocks.
  A path the user may need to point at (e.g. `BLENDER_PATH`) is an optional, non-secret credentials field.

**Round 2b: know-how** (skills)
Tools are what the agent can *do*; skills are what it *knows how to do well*. Propose 2-5 skills for the domain's
recurring, multi-step jobs: a workflow ("plan a print job"), a checklist or standard ("pre-flight checks before
publishing"), reference knowledge (formulas, rules of thumb, house style), or a quality bar with examples.
Ask (multi, pre-described as `name — when the agent uses it`) which to include; "Other" adds the user's own procedures.

**Round 3: risk**
- guards (multi): protect secrets (.env, *.key, *.pem) [recommended], confirm destructive shell commands [recommended], read-only mode, block network writes
- (what the agent must never do comes from the open "anything else?" answer; put it in `prompt.system` and guards)

**Round 4: what the user needs to SEE** (the important one)
- Show the available views from `forge_list views` whose domains match, plus `data-table`/`chart`/`markdown-doc` as general options. Ask (multi) which results they want to see and how.
- For each picked view: which tool results show in it, and whether it should be a pinned panel (only for the "current thing" the user keeps looking at).
- If they need something no view covers (e.g. "a map", "a waveform", "a crystal lattice"), note it: you will build it with the `view-builder` skill.

**Round 5: look and model**
- theme accent (single, offer 4 named colors that suit the domain, e.g. "teal okhsl(175 60% 66%)", plus "system terminal colors")
- header art (single: from `forge_list art`)
- model (single: "Opus 5.5 on Bedrock (global.anthropic.claude-opus-5-5)" recommended / "Sonnet 5.5 on Bedrock (global.anthropic.claude-sonnet-5-5)" faster and cheaper / Other)
- name (free text, lowercase-dashes, suggest one) and title

## 2. Write the spec
1. `forge_init` with name/title/description.
2. Edit `harnesses/<name>/harness.yaml`:
   - `tools.custom`: the tool names you will write (snake_case verbs: `search_papers`, `get_render_status`).
   - `ui.views`: each `{ id, shows: [tool names], panel? }`.
   - `credentials`: one entry per service the tools need, so it shows up in the harness's Settings:
     ```yaml
     credentials:
       - id: openweather
         label: OpenWeather
         note: Free tier is enough. Used for live forecasts.
         url: https://home.openweathermap.org/api_keys
         tools: [get_forecast]
         fields:
           - { env: OPENWEATHER_API_KEY, label: API key, placeholder: "32 characters" }
       - id: blender
         label: Blender
         note: Only needed for photo-real renders.
         fields:
           - { env: BLENDER_PATH, label: Path to blender.exe, secret: false, optional: true }
     ```
     Name variables after the service (`SHOPIFY_ACCESS_TOKEN`, not `TOKEN`). IDs, regions and paths get `secret: false`.
     Model-provider keys (Anthropic, OpenAI, AWS) are set once for every harness: never list them here.
   - `prompt.system`: 5-10 lines: role, which tool to use when, domain rules (units, sources, safety), what never to do. Don't describe the views; forge adds that.
   - `ui.header.hint`: one example request that exercises the main tool (it also becomes the "Try an example" card).
   - `ui.web`: the browser welcome screen. Write all three:
     `headline` (a short, confident sentence in the user's domain, e.g. "What are we printing today?"),
     `subtitle` (one line on what the harness does), `placeholder` (what to type, e.g. "Describe the part you need...").
3. Show the user the YAML (as a short summary of the important choices) and get a yes.
4. `forge_validate`; fix every error.

## 2b. Draw the logo
Every harness gets a logo mark at `harnesses/<name>/custom/brand/mark.svg` (the web UI shows it in the sidebar, on the welcome
screen, and as the favicon; the terminal keeps its ASCII header art). Style, matching forge's poster:
- `viewBox="0 0 48 48"`, one or two `<path>` elements, **no `fill`/`stroke` attributes** (the UI paints the mark in ink or paper);
  use `fill-rule="evenodd"` on the `<svg>` for holes.
- Solid, bold geometry with 45° chamfered corners; one clear symbol of the domain (a ring, a nozzle, a wing, a bottle…).
- It must read at 16 px: no thin lines (≥ 4 units), no text, no more than ~6 shapes.
- Optional `custom/brand/wordmark.svg` (mark plus name as paths) replaces the plain title in the sidebar.
Show the user the mark (the Views page and the welcome screen display it) and offer one redraw if they don't like it.

## 3. Write the custom tools
Build every tool in the confirmed toolkit, not a subset; each must really work (no stubs or fake data).
Use the `tool-builder` skill for each tool in `tools.custom`. Write them in `harnesses/<name>/custom/extensions/<topic>-tools.ts`. Every tool returns `viewResult(text, viewId, data)` where the data matches the view's `types.ts`.
Tools read keys with `requireKey("ENV_NAME")` from `forge_modules/keys.ts` (generated from `credentials:`), so a missing key
tells the user exactly where to add it.

## 3b. Write the skills
Use the `skill-builder` skill for each confirmed skill: `harnesses/<name>/custom/skills/<skill-name>/SKILL.md`, plus any
`references/` files it needs. Write real domain substance (steps, numbers, criteria, the tools to call at each step),
not generic advice. The harness's agent sees each skill's description and loads it when a task matches.

## 4. Generate and test
1. `forge_generate` (dry run), then `forge_generate` with `apply: true`.
2. `forge_smoke` with the harness name (load check). Fix any extension error it reports (file + line are in the output).
   Its `skills` row must list every skill you wrote; its `keys` row shows which keys the user still has to add.
3. `forge_smoke` with a realistic `prompt` that should call the main tools; check the tools ran and returned the expected views.
4. If a custom view was needed: `view-builder` skill, then regenerate.

## 5. Package it (the final output)
A finished harness ends as an app the user can run and share. Ask with `forge_ask` (one multi-select question):
"Package <Title> as an app on your Desktop? Pick the systems:"
- Windows (x64): pre-ticked when this computer is Windows. Use `windows-x64`, or `windows-arm64` for ARM PCs.
- macOS, Apple Silicon (M1 and later): `darwin-arm64`.
- macOS, Intel: `darwin-x64`.
- Linux (x64): `linux-x64`.
- Not now.

Then call `forge_package` once with `targets` set to every system they picked and `desktop: true`. Each package lands on
their Desktop as a folder plus a zip to share. Builds for other systems are cross-compiled here and can't be test-run on
this computer, so say so. macOS and Linux users run `chmod +x` once (the package's README explains it, and the macOS
quarantine step). If a build fails, report it and keep the others.

## 6. Hand over
Tell the user, briefly:
- The packages on their Desktop (a folder and a zip per system). They run without Node or this repo:
  `<name> web` (or the `<name>-web` launcher) for the browser UI.
- From the repo: `node harnesses/<name>/bin/<name>.ts` for the terminal UI
- `node harnesses/<name>/bin/<name>.ts web`: browser UI with the views (and `/preview` for all views)
- `node harnesses/<name>/bin/<name>.ts -p "..."` / `--mode json` / `--mode rpc`: headless
- Keys: which ones to add, and where: **Settings → <Title> keys** in the browser, `/keys` in the terminal, or the environment variables (for headless use)
- Skills: the ones it has, and that `/skill:<name>` runs one directly
- In the browser UI: Settings has MCP servers (connect more tools), Safety (sandbox mode) and Usage (tokens and cost);
  the Schedules page runs prompts on their own
- To grow it later: the **Add to <Title>** page in its browser sidebar (a pi-Forge chat just for that harness, which reloads it when done), or ask pi-Forge here ("update <name>: ...").
