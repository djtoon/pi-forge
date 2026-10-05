import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { HarnessSpec } from "@forge/harness-spec";

/**
 * Per-harness choices made in Settings that aren't keys: <agent dir>/forge-settings.json.
 * The launcher reads them on every start (and scheduled runs start the same way), so they apply in every mode.
 */
export type SandboxMode = "off" | "workspace" | "read-only";

export interface HarnessSettings {
	sandbox?: { mode?: SandboxMode; folder?: string };
}

export function harnessSettingsFile(agentDir: string): string {
	return join(agentDir, "forge-settings.json");
}

export function readHarnessSettings(agentDir: string): HarnessSettings {
	const file = harnessSettingsFile(agentDir);
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf8")) as HarnessSettings;
	} catch {
		return {};
	}
}

function writeHarnessSettings(agentDir: string, settings: HarnessSettings): void {
	const file = harnessSettingsFile(agentDir);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(settings, null, "\t")}\n`);
}

/** The sandbox in effect: the Settings choice, else the spec's guards.sandbox, else off. Folder defaults to where the harness runs. */
export function activeSandbox(spec: HarnessSpec, agentDir: string, cwd = process.cwd()): { mode: SandboxMode; folder: string; source: "settings" | "spec" | "default" } {
	const saved = readHarnessSettings(agentDir).sandbox;
	const mode = saved?.mode ?? spec.guards?.sandbox ?? "off";
	const source = saved?.mode ? "settings" : spec.guards?.sandbox ? "spec" : "default";
	return { mode, folder: resolve(cwd, saved?.folder || "."), source };
}

export function saveSandbox(agentDir: string, input: { mode?: unknown; folder?: unknown }): void {
	const mode = input.mode;
	if (mode !== "off" && mode !== "workspace" && mode !== "read-only") throw new Error("mode must be off, workspace or read-only");
	const folder = typeof input.folder === "string" ? input.folder.trim() : "";
	if (folder) {
		if (!isAbsolute(folder)) throw new Error("Use a full folder path, e.g. C:\\Users\\you\\projects\\work");
		if (!existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
	}
	const settings = readHarnessSettings(agentDir);
	settings.sandbox = { mode, ...(folder ? { folder } : {}) };
	writeHarnessSettings(agentDir, settings);
}
