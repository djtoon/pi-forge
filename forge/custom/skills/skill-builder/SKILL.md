---
name: skill-builder
description: Write a skill for a pi-Forge harness (custom/skills/<name>/SKILL.md) that teaches its agent a domain workflow, checklist, standard or body of reference knowledge. Use when building or updating a harness and its agent should know how to do a recurring job well, or when a harness skill must be fixed.
---

# Build a harness skill

A skill is know-how the harness's agent loads only when a task needs it. pi lists every skill's `name` and
`description` in the agent's prompt; when a task matches, the agent reads the whole `SKILL.md`. The user can also
run one directly with `/skill:<name>`, and the browser's Tools page lists them.

## Where
```
harnesses/<harness>/custom/skills/<skill-name>/
  SKILL.md          required
  references/       optional: longer reference material the skill points to (tables, specs, examples)
  scripts/          optional: helper scripts the skill tells the agent to run
```
The generator never touches `custom/`, and every harness already loads `custom/skills/`.

## SKILL.md
```markdown
---
name: print-job-planner
description: Plan a 3D print job end to end (orientation, supports, material, slicer settings, time and cost). Use when the user wants to print a part or asks how to print something.
---

# Plan a print job

1. Inspect the model with `analyze_mesh`: size, overhangs over 45°, thin walls under 0.8 mm.
2. ...
```
- `name`: lowercase letters, numbers and single hyphens, at most 64 characters, **the same as the folder name**.
- `description`: at most 1024 characters. Say what it does **and when to use it**, with the words a user would
  actually say. The agent decides from this line alone, so "Helps with printing" is useless.
- Body: direct instructions to the agent, in steps. Name the harness's real tools at each step
  (`analyze_mesh`, `slice_model`), the numbers and thresholds that matter, the checks to run before showing a
  result, and what a good result looks like. Domain substance only: no generic advice like "be thorough".
- Keep it under ~150 lines; move long tables or specs into `references/<topic>.md` and say when to read them.
- Paths to bundled files are relative to the skill folder.

## Good skill topics
- A recurring multi-step job (a workflow the user does every week)
- A checklist or standard the result must pass (house rules, regulations, a style guide)
- Reference knowledge the model gets wrong from memory (formulas, part numbers, API quirks, unit conventions)
- A quality bar with one or two worked examples of a great result

## Check
1. `forge_validate`: reports a skill pi would skip (no frontmatter, missing description, bad name), with its path.
2. `forge_smoke`: its `skills` row must list the new skill as loaded.
3. Optionally a live `forge_smoke` prompt that should trigger the skill, and check the answer follows it.
