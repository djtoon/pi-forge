// Copied by forge from templates/guards/sandbox.ts. Do not edit here: edit the template and regenerate.
import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Sandbox mode, chosen in the harness's Settings (or `guards.sandbox` in harness.yaml as the default).
 * harness-core passes the active choice in FORGE_SANDBOX: { "mode": "off" | "workspace" | "read-only", "folder": "<path>" }.
 *
 *   workspace   file tools (read, write, edit, grep, find, ls) stay inside the workspace folder;
 *               every shell command needs the user's OK (blocked when no one can answer)
 *   read-only   file tools may only read, inside the workspace folder; no shell commands; no writes
 *
 * This is a policy inside the harness, not an operating-system sandbox: the harness's own custom tools and MCP
 * servers run as normal code. For full isolation, run the harness in a container (see pi's containerization docs).
 */
export type SandboxMode = "off" | "workspace" | "read-only";

const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

function activeSandbox(fallback: SandboxMode): { mode: SandboxMode; folder: string } {
	try {
		const parsed = JSON.parse(process.env.FORGE_SANDBOX ?? "{}") as { mode?: SandboxMode; folder?: string };
		return { mode: parsed.mode ?? fallback, folder: resolve(parsed.folder || process.cwd()) };
	} catch {
		return { mode: fallback, folder: process.cwd() };
	}
}

function inside(folder: string, target: string): boolean {
	const rel = relative(folder, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function createSandbox(defaultMode: SandboxMode = "off") {
	return function (pi: ExtensionAPI) {
		const { mode, folder } = activeSandbox(defaultMode);
		if (mode === "off") return;
		const label = mode === "read-only" ? "Read-only sandbox" : "Workspace sandbox";

		pi.on("tool_call", async (event, ctx) => {
			const input = event.input as { path?: unknown; file_path?: unknown; command?: unknown };
			if (FILE_TOOLS.has(event.toolName)) {
				if (mode === "read-only" && WRITE_TOOLS.has(event.toolName)) {
					return { block: true, reason: `${label}: writing files is off. Show the user the content instead, or ask them to turn the sandbox off in Settings.` };
				}
				const raw = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : undefined;
				const target = resolve(process.cwd(), raw ?? ".");
				if (!inside(folder, target)) {
					return { block: true, reason: `${label}: ${raw ?? target} is outside the workspace folder ${folder}. Work inside it, or ask the user to change the folder in Settings.` };
				}
				return;
			}
			if (SHELL_TOOLS.has(event.toolName)) {
				if (mode === "read-only") return { block: true, reason: `${label}: shell commands are off.` };
				const command = typeof input.command === "string" ? input.command : "";
				if (ctx.hasUI && (await ctx.ui.confirm(label, `Run this command?\n\n${command.slice(0, 1500)}`))) return;
				return { block: true, reason: `${label}: the user didn't approve this command${ctx.hasUI ? "" : " (no one to ask in headless mode)"}.` };
			}
		});
	};
}
