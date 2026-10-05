import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readSpecFile } from "@forge/harness-spec";

/**
 * Smoke tests for a generated harness, run as child processes:
 * - loadCheck: start it in RPC mode and ask for its state. Proves the launcher, spec, and every
 *   extension load. No model call, no cost.
 * - liveCheck: run one prompt headless (--mode json) and report tool calls and the answer. Costs tokens.
 */

export interface LoadCheck {
	ok: boolean;
	model?: string;
	commands: number;
	/** Skills pi loaded (from custom/skills) */
	skills: string[];
	stderr: string[];
	error?: string;
	ms: number;
}

export interface LiveCheck {
	ok: boolean;
	tools: { name: string; isError: boolean; view?: string }[];
	answer: string;
	stderr: string[];
	error?: string;
	ms: number;
}

function harnessBin(harnessDir: string): string {
	const name = (readSpecFile(harnessDir) as { name?: string }).name ?? "";
	const bin = join(harnessDir, "bin", `${name}.ts`);
	if (!existsSync(bin)) throw new Error(`${bin} not found: generate the harness first`);
	return bin;
}

/** stderr lines worth reporting (Node's experimental-feature warnings are noise). */
function relevant(stderr: string): string[] {
	return stderr
		.split(/\r?\n/)
		.filter((l) => l.trim() && !/ExperimentalWarning|--trace-warnings|^\(node:\d+\)/.test(l))
		.slice(0, 30);
}

function lines(onLine: (line: string) => void): (chunk: Buffer) => void {
	let buffer = "";
	return (chunk) => {
		buffer += chunk.toString("utf8");
		let i = buffer.indexOf("\n");
		while (i >= 0) {
			const line = buffer.slice(0, i).replace(/\r$/, "");
			buffer = buffer.slice(i + 1);
			if (line.trim()) onLine(line);
			i = buffer.indexOf("\n");
		}
	};
}

export function loadCheck(harnessDir: string, timeoutMs = 45_000): Promise<LoadCheck> {
	const started = Date.now();
	const child = spawn(process.execPath, [harnessBin(harnessDir), "--mode", "rpc", "--no-session"], { cwd: harnessDir, stdio: ["pipe", "pipe", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (d: Buffer) => {
		stderr += d.toString("utf8");
	});
	return new Promise((resolveCheck) => {
		const result: LoadCheck = { ok: false, commands: 0, skills: [], stderr: [], ms: 0 };
		const finish = (error?: string) => {
			clearTimeout(timer);
			child.kill();
			result.ms = Date.now() - started;
			result.stderr = relevant(stderr);
			result.error = error;
			result.ok = !error && result.model !== undefined;
			resolveCheck(result);
		};
		const timer = setTimeout(() => finish(`no answer within ${timeoutMs / 1000}s`), timeoutMs);
		child.on("exit", (code) => finish(`exited early with code ${code}`));
		child.stdout.on(
			"data",
			lines((line) => {
				const record = JSON.parse(line) as { type?: string; command?: string; success?: boolean; data?: { model?: { id?: string; name?: string }; commands?: { name?: string; source?: string }[] } };
				if (record.type !== "response") return;
				if (record.command === "get_state") {
					result.model = record.data?.model?.id ?? "(none selected)";
					child.stdin.write(`${JSON.stringify({ type: "get_commands" })}\n`);
				} else if (record.command === "get_commands") {
					result.commands = record.data?.commands?.length ?? 0;
					result.skills = (record.data?.commands ?? []).filter((c) => c.source === "skill").map((c) => (c.name ?? "").replace(/^skill:/, ""));
					finish();
				}
			}),
		);
		child.stdin.write(`${JSON.stringify({ type: "get_state" })}\n`);
	});
}

export function liveCheck(harnessDir: string, prompt: string, timeoutMs = 240_000): Promise<LiveCheck> {
	const started = Date.now();
	const child = spawn(process.execPath, [harnessBin(harnessDir), "--mode", "json", "--no-session", "-p", prompt], { cwd: harnessDir, stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (d: Buffer) => {
		stderr += d.toString("utf8");
	});
	return new Promise((resolveCheck) => {
		const result: LiveCheck = { ok: false, tools: [], answer: "", stderr: [], ms: 0 };
		let settled = false;
		const timer = setTimeout(() => {
			child.kill();
			result.error = `timed out after ${timeoutMs / 1000}s`;
		}, timeoutMs);
		child.stdout.on(
			"data",
			lines((line) => {
				const e = JSON.parse(line) as {
					type?: string;
					toolName?: string;
					isError?: boolean;
					result?: { details?: { view?: string } };
					message?: { role?: string; content?: { type: string; text?: string }[]; stopReason?: string; errorMessage?: string };
				};
				if (e.type === "tool_execution_end") result.tools.push({ name: e.toolName ?? "?", isError: !!e.isError, view: e.result?.details?.view });
				if (e.type === "message_end" && e.message?.role === "assistant") {
					const text = (e.message.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
					if (text) result.answer = text;
					if (e.message.stopReason === "error") result.error = e.message.errorMessage ?? "model error";
				}
				if (e.type === "agent_settled") settled = true;
			}),
		);
		child.on("exit", (code) => {
			clearTimeout(timer);
			result.ms = Date.now() - started;
			result.stderr = relevant(stderr);
			if (!settled && !result.error) result.error = `exited with code ${code} before finishing`;
			result.ok = settled && !result.error;
			resolveCheck(result);
		});
	});
}
