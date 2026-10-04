---
name: view-builder
description: Create a new domain view (how a kind of tool result is shown in the terminal and the web UI), e.g. a map, timeline, waveform, kanban, or crystal structure, when no view in templates/views fits. Use when a harness needs to show something the existing views cannot.
---

# Build a view

A view turns a tool result's `details: { view: "<id>", data }` into something the user sees. It has five files in `harnesses/<name>/custom/views/<id>/`:

| File | Content |
|---|---|
| `view.json` | `{ id, title, description, domains: [...], dataType, panel: bool, panelTitle, files: { types, tui, web, sample } }` |
| `types.ts` | `export interface <DataType> { ... }`: the data contract tools must return |
| `tui.ts` | `export function renderTui(data, theme, expanded): Component` and `export function summarize(data): string` |
| `web.js` | `export function render(el, data, ctx)`: plain browser ES module, no build step; may return a cleanup function |
| `sample.json` | realistic example data (used by the checker and the web `/preview` page) |

**Copy the closest existing view** from `templates/views/` (molecule = rich object + 3D library; chart = SVG drawing; data-table = tabular; image-gallery = media; diff/markdown-doc = text) and adapt it.

## Terminal (`tui.ts`)
- Imports: `type Theme` from `@earendil-works/pi-coding-agent`; `type Component`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi` from `@earendil-works/pi-tui`; the data type from `./types.ts`.
- Return `{ render(width) { return lines.map(l => truncateToWidth(l, width)) }, invalidate() {} }`. Every line must fit `width`.
- Collapsed (`expanded: false`): 1-6 lines, the essentials. Expanded: the details.
- Colors only via `theme.fg("accent" | "muted" | "dim" | "success" | "error" | "warning" | "text", s)` and `theme.bold(s)`.
- The terminal can't show images or 3D: show the key numbers and say "open the web UI" for the rich version.

## Web (`web.js`)
- `ctx`: `{ theme: { accent, fg, muted, bg, panel, border, dark }, expanded, loadScript(url) → Promise, openView(viewId, value) }`.
- Third-party libraries: `await ctx.loadScript("https://cdn.jsdelivr.net/npm/<pkg>@<exact version>/...")` then use the global. Pin exact versions. Provide a fallback if loading fails (offline).
- Put tool data in the DOM with `textContent`, never `innerHTML` (tool data can contain anything). If you must render HTML (e.g. markdown), sanitize it with DOMPurify.
- Use the shared CSS variables (`var(--accent)`, `var(--fg)`, `var(--muted)`, `var(--surface-2)`, `var(--line)`, `var(--mono)`) so it matches the harness theme. Prefix your classes with `v-<id>-`.
- Plain `<button>` elements are styled by the app (pill buttons); give a selected toggle the class `on`. Do not hardcode button colors.
- Per-harness example data for the Views page: `custom/samples/<view-id>.json` (overrides the view's `sample.json`).
- It must work at panel width (~380px) and in a chat card (~900px).

## Check and use
1. `forge_check_view` with `view` and `harness`: fix every error (it renders `sample.json` at 40/80/140 columns).
2. Add `{ id, shows: [...], panel? }` to `ui.views` in harness.yaml; `forge_validate`; `forge_generate` with apply.
3. Tell the user to open `node harnesses/<name>/bin/<name>.ts web` and check `/preview` to see it rendered with the sample.
4. If it is generally useful, offer `forge_promote_view` to move it into `templates/views/` for other harnesses.
