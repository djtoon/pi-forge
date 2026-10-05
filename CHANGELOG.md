# Changelog

All notable changes to pi-Forge. Versions follow [Semantic Versioning](https://semver.org).

## 1.0.1 (2026-10-05)

### New
- **Add to harness.** Every harness's browser UI now has an *Add to <Title>* page in the sidebar. It's a chat with pi-Forge's agent, scoped to that one harness, for growing it with tools, views, data sources, skills and fixes. pi-Forge writes, validates, generates and smoke-tests each change. The harness then reloads by itself, so the new tool works in your next message. These chats are kept per harness.
- **Keys for a harness's tools.** A new `credentials:` section in `harness.yaml` declares the keys and settings a harness's tools need: API keys, account IDs, regions, program paths. Each service gets a card on the harness's Settings page, with a note, the tools that use it, a "Get a key" link and a *Needed / Set / Optional* badge.
  - **Other ways to set them:** `/keys` in the terminal, or environment variables for headless runs.
  - **Storage:** values are saved per harness in `~/.forge/<name>/credentials.json`, given only to that harness, and masked in the browser.
  - **Missing keys:** the welcome screen shows "Add your … key" until a required key is set. Tools read keys with `requireKey()`, whose error tells you which key is missing and where to add it.
- **Skills in every harness.** pi-Forge now writes 2-5 domain skills (workflows, checklists, standards, reference knowledge) into each harness it builds, using the new `skill-builder` skill. The Tools page lists them, and `/skill:<name>` runs one. The examples gained `compound-profile` (chem) and `refinance-check` (loan-calc).
- **Live status in the chat.** While the agent works, a status line stays at the bottom of the chat. It shows what's happening (thinking, writing a file, running a tool, writing the reply), how long that step has taken, and a short preview of the agent's reasoning.
  - **Queued messages:** a message sent mid-task shows as *Queued* until the agent reads it.
  - **After a refresh:** the status comes back with the right step and timers, and loading placeholders show while chats load.
- **Questions you can answer your own way.** Every question with options also has a box to type your own answer, and each round of questions ends with an open "Anything else?" box.

### Fixed
- **Questions form:**
  - The "Other" text box was invisible, so typed answers never came through.
  - Pressing Enter in a text box closed the form without sending the answer.
- **Skills:** harnesses no longer load skills installed elsewhere on your machine (`~/.agents/skills`); each loads only its own.
- **Missing provider key:** a harness's Settings page showed "unknown" for the model, with no hint to add a key.
- **Models:**
  - A spec's Bedrock model now falls back to the same model on Anthropic when only an Anthropic key is set.
  - If neither is set, pi picks a model from the provider you do have, instead of failing.
- **Favicon:** it now matches the logo (ink "Pi" on paper). Logos with hard-coded colors no longer disappear.

### For harness authors
- **`forge_validate`** now:
  - warns about environment variables your tools read without declaring them under `credentials:`;
  - rejects system variables and model-provider keys there;
  - reports any skill file pi would skip, with the reason.
- **`forge_smoke`** lists the skills that loaded and which keys are still missing.
- **`npm run verify`** fails when generated files are out of date (CI runs it).
- **`npm run doctor`** checks that a machine is ready to run pi-Forge.

### Upgrading
Pull, run `npm install`, then `npm run upgrade -- --apply` to regenerate your harnesses. Restart any harness web UI you have open. Then ask pi-Forge to update your harnesses: it adds `credentials:` for the environment variables they read and writes their skills.

## 1.0.0 (2026-10-04)

First public release: pi-Forge, an agent harness that builds agent harnesses on top of pi.
- **Building harnesses:** the interview, the generator, shared views and templates, and the plan tool.
- **Running them:** the browser UI with domain views; terminal and headless modes; and standalone packaged programs.
- **Examples:** chem and loan-calc.
