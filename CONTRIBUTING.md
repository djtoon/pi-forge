# Contributing to pi-Forge

Thanks for helping! Bug reports, new views, tool templates, docs and fixes are all welcome.

## Setup

```bash
git clone https://github.com/djtoon/pi-forge.git
cd pi-forge
npm install
npm run doctor
```

Node 22.18+ runs the TypeScript sources directly (type stripping), so there's no build step.

## Before you open a pull request

```bash
npm run verify     # type check, generator dry run, load check of every harness
```

- **Changed `packages/harness-spec`?** Run `npm run schema` and commit `schema/harness.schema.json`.
- **Changed `templates/`?** Run `npm run upgrade -- --apply` to regenerate `forge/` and the example harnesses, and commit the regenerated files. CI fails if a generated file is out of date.
- **Changed the web UI?** Check it in a browser (`npm run chem -- web`) in both the Paper and Ink appearances, and at phone width.

## Where things go

| You want to… | Edit |
|---|---|
| Change what every harness gets | `templates/` (then regenerate) |
| Add a shared view | `templates/views/<id>/` with `view.json`, `types.ts`, `tui.ts`, `web.js`, `sample.json` (check it with `npm run check-view -- <id>`) |
| Add a spec field | `packages/harness-spec` (schema and validation), then `packages/forge-gen` (generation) |
| Change the launcher or modes | `packages/harness-core` |
| Change the browser UI | `packages/harness-web` (`public/` is plain JS, no build step) |
| Change how pi-Forge interviews or builds | `forge/harness.yaml` (prompt) and `forge/custom/` (tools, skills) |

Never edit generated files by hand (the generator detects it). See [docs/architecture.md](docs/architecture.md).

## Style

- TypeScript, ES modules, tabs. Match the code around your change.
- Keep the browser UI dependency-free. Views may load a library from a CDN when they truly need it (for example 3Dmol.js).
- Tools stay UI-free: return `viewResult(text, viewId, data)`, and let views draw.
- No secrets, personal paths or work output in commits. Harnesses you build for yourself stay local (`.gitignore`). Only `harnesses/chem` and `harnesses/loan-calc` are examples in the repo.

## Example harnesses

A new example is welcome if it shows something the others don't (a new kind of view or tool). Add it to the allow-list in `.gitignore` and to the README.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
