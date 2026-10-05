---
name: harness-update
description: Change an existing harness (add or remove tools, views, panels, guards; change theme, model, prompt; upgrade it) by editing its harness.yaml and custom code, then regenerating. Use when the user wants to modify, extend, fix, or re-skin a harness that already exists.
---

# Update a harness

1. **Read the current state**: `forge_list`, then read `harnesses/<name>/harness.yaml` and list `harnesses/<name>/custom/`.
2. **Keep the toolkit complete.** If the request shows the agent lacks a capability (a source, checker, calculator, previewer, exporter), propose the missing tools as part of the change.
3. **Ask only about the change.** If the request is clear ("add a chart of X"), don't interview; if it is vague ("make it better for Y"), ask 1-3 targeted questions with `forge_ask` (options first).
4. **Edit the right place**, never generated files (the guard blocks them anyway):
   | Change | Where |
   |---|---|
   | model, thinking, built-in tools, guards, theme, header, panels, which tools show in which view | `harness.yaml` |
   | system prompt text | `harness.yaml` → `prompt.system` |
   | a tool's behavior, a new tool | `custom/extensions/*.ts` (see `tool-builder`); add its name to `tools.custom` |
   | a new kind of visual | `view-builder` skill, then add it to `ui.views` |
   | a key, account ID or path a tool needs | `harness.yaml` → `credentials:` (shows in the harness's Settings); the tool reads it with `requireKey` |
   | how the agent should do a recurring job (workflow, checklist, standard, house style) | a skill in `custom/skills/<name>/SKILL.md` (see `skill-builder`) |
   | a change every harness should get (template bug, new art) | `templates/`; then regenerate every harness |
5. `forge_validate` → `forge_generate` (dry run; show the user the file list) → `forge_generate` with `apply: true`.
   - If it reports "edited by hand", someone changed a generated file: move that change into the spec, `custom/`, or the template; use `force` only if the user agrees to discard it.
6. `forge_smoke` (load check), plus a live `prompt` when tools or prompts changed. Its `skills` row must list every skill; its `keys` row shows which keys the user still has to add.
   - When `forge_validate` warns that code reads an undeclared environment variable, add it to `credentials:` so users can set it in Settings.
7. Summarize what changed and how to see it (restart the harness or run `/reload` inside it).
