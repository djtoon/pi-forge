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
- For each external API: auth? (none / env var name / OAuth). Never ask for secret values; only the env var name.
- Programs the tools could use if installed (e.g. a slicer, ffmpeg, a CAD kernel): check with `bash` whether they exist and say what each unlocks.

**Round 3: risk**
- guards (multi): protect secrets (.env, *.key, *.pem) [recommended], confirm destructive shell commands [recommended], read-only mode, block network writes
- anything the agent must never do (free text, optional)

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

## 4. Generate and test
1. `forge_generate` (dry run), then `forge_generate` with `apply: true`.
2. `forge_smoke` with the harness name (load check). Fix any extension error it reports (file + line are in the output).
3. `forge_smoke` with a realistic `prompt` that should call the main tools; check the tools ran and returned the expected views.
4. If a custom view was needed: `view-builder` skill, then regenerate.

## 5. Hand over
Tell the user, briefly:
- `node harnesses/<name>/bin/<name>.ts`: terminal UI
- `node harnesses/<name>/bin/<name>.ts web`: browser UI with the views (and `/preview` for all views)
- `node harnesses/<name>/bin/<name>.ts -p "..."` / `--mode json` / `--mode rpc`: headless
- To change it later: ask forge ("update <name>: ..."), which uses the `harness-update` skill.
