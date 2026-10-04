#!/usr/bin/env node
/**
 * Checks one view folder (templates/views/<id> or <harness>/custom/views/<id>):
 * - view.json has the required fields and the files it lists exist,
 * - tui.ts exports renderTui + summarize, and renders sample.json collapsed and expanded
 *   at several widths without a line exceeding the width,
 * - web.js exports render(el, data, ctx).
 * Prints a JSON report; exit code 1 when anything failed. Runs as its own process so a broken
 * view cannot take down the agent that is checking it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";

interface Report {
	view: string;
	ok: boolean;
	errors: string[];
	warnings: string[];
	summary?: string;
	preview?: string[];
}

const REQUIRED = ["id", "title", "description", "domains", "dataType", "files"];

// Theme stub: same method shapes as pi's Theme, no colors. Enough to exercise layout code.
const theme = {
	fg: (_c: string, t: string) => t,
	bg: (_c: string, t: string) => t,
	bold: (t: string) => t,
	italic: (t: string) => t,
	underline: (t: string) => t,
	dim: (t: string) => t,
};

export async function checkView(dir: string): Promise<Report> {
	const report: Report = { view: dir, ok: false, errors: [], warnings: [] };
	const metaFile = join(dir, "view.json");
	if (!existsSync(metaFile)) {
		report.errors.push("missing view.json");
		return report;
	}
	const meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown> & { files?: Record<string, string> };
	report.view = String(meta.id ?? dir);
	for (const key of REQUIRED) if (meta[key] === undefined) report.errors.push(`view.json: missing "${key}"`);
	const files = { types: "types.ts", tui: "tui.ts", web: "web.js", sample: "sample.json", ...(meta.files ?? {}) };
	for (const [role, file] of Object.entries(files)) {
		if (!existsSync(join(dir, file))) report.errors.push(`missing ${role} file ${file}`);
	}
	if (report.errors.length > 0) return report;

	const sample = JSON.parse(readFileSync(join(dir, files.sample), "utf8")) as unknown;

	try {
		const mod = (await import(pathToFileURL(resolve(dir, files.tui)).href)) as {
			renderTui?: (data: unknown, theme: unknown, expanded: boolean) => { render(width: number): string[] };
			summarize?: (data: unknown) => string;
		};
		if (typeof mod.renderTui !== "function") report.errors.push("tui.ts: no renderTui export");
		if (typeof mod.summarize !== "function") report.errors.push("tui.ts: no summarize export");
		if (mod.renderTui && mod.summarize) {
			report.summary = mod.summarize(sample);
			for (const expanded of [false, true]) {
				for (const width of [40, 80, 140]) {
					const lines = mod.renderTui(sample, theme, expanded).render(width);
					if (!Array.isArray(lines)) report.errors.push(`renderTui().render(${width}) did not return string[]`);
					const over = lines.findIndex((l) => visibleWidth(l) > width);
					if (over >= 0) report.errors.push(`line ${over} exceeds width ${width} (expanded=${expanded}): ${lines[over]}`);
					if (lines.length === 0) report.warnings.push(`renders no lines (expanded=${expanded})`);
					if (expanded && width === 80) report.preview = lines.slice(0, 20);
				}
			}
		}
	} catch (error) {
		report.errors.push(`tui.ts failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	const web = readFileSync(join(dir, files.web), "utf8");
	if (!/export\s+(async\s+)?function\s+render\s*\(/.test(web)) report.errors.push("web.js: no `export function render(el, data, ctx)`");
	if (/\binnerHTML\s*=/.test(web) && !/DOMPurify|textContent/.test(web)) {
		report.warnings.push("web.js sets innerHTML: make sure tool data is escaped or sanitized");
	}

	report.ok = report.errors.length === 0;
	return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const dirs = process.argv.slice(2);
	const reports = [];
	for (const dir of dirs) reports.push(await checkView(resolve(dir)));
	console.log(JSON.stringify(reports, null, 2));
	process.exit(reports.every((r) => r.ok) ? 0 : 1);
}
