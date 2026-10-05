import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * MCP servers a user adds in a harness's Settings. pi connects them itself: it reads <agent dir>/mcp.json
 * (~/.forge/<name>/mcp.json for a harness), so each harness has its own servers. Secret values (env and headers)
 * never leave this process in full: the page gets a masked preview, and an unchanged preview keeps the saved value.
 */

export interface McpServerView {
	name: string;
	kind: "stdio" | "http";
	command?: string;
	args?: string[];
	cwd?: string;
	url?: string;
	/** Variable or header name → masked value (or a ${VAR} reference, shown as is) */
	env?: Record<string, string>;
	headers?: Record<string, string>;
	exposure: string;
	enabled: boolean;
	description?: string;
}

interface RawServer {
	type?: string;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	exposure?: string;
	enabled?: boolean;
	description?: string;
	[key: string]: unknown;
}

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const EXPOSURES = ["direct", "deferred", "codemode", "hidden"];
const MASK = "••••";

export function mcpFile(agentDir: string): string {
	return join(agentDir, "mcp.json");
}

function readConfig(agentDir: string): { mcpServers: Record<string, RawServer>; [key: string]: unknown } {
	const file = mcpFile(agentDir);
	if (!existsSync(file)) return { mcpServers: {} };
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, RawServer> };
		return { ...parsed, mcpServers: parsed.mcpServers ?? {} };
	} catch {
		throw new Error(`${file} is not valid JSON; fix or delete it first`);
	}
}

function writeConfig(agentDir: string, config: unknown): void {
	const file = mcpFile(agentDir);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(config, null, "\t")}\n`, { mode: 0o600 });
	try {
		chmodSync(file, 0o600);
	} catch {
		// best effort on Windows
	}
}

/** ${VAR} references and !commands are shown as written; literal values are masked. */
function maskValue(value: string): string {
	if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) || value.startsWith("!")) return value;
	return value.length <= 8 ? MASK : `${MASK}${value.slice(-4)}`;
}

function maskMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!map) return undefined;
	return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, maskValue(String(v))]));
}

export function listMcpServers(agentDir: string): McpServerView[] {
	const { mcpServers } = readConfig(agentDir);
	return Object.entries(mcpServers).map(([name, s]) => ({
		name,
		kind: s.url ? "http" : "stdio",
		command: s.command,
		args: s.args,
		cwd: s.cwd,
		url: s.url,
		env: maskMap(s.env),
		headers: maskMap(s.headers),
		exposure: s.exposure ?? "codemode",
		enabled: s.enabled !== false,
		description: s.description,
	}));
}

function cleanMap(input: unknown, previous: Record<string, string> | undefined, what: string): Record<string, string> | undefined {
	if (input === undefined || input === null) return undefined;
	if (typeof input !== "object" || Array.isArray(input)) throw new Error(`${what} must be name → value pairs`);
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
		const key = k.trim();
		if (!key) continue;
		if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key)) throw new Error(`${what} name "${key}" has invalid characters`);
		if (typeof v !== "string" || v.length > 8192 || /[\r\n\0]/.test(v)) throw new Error(`${what} "${key}" has an invalid value`);
		// An unchanged masked preview keeps the saved value.
		out[key] = v.startsWith(MASK) && previous?.[key] !== undefined ? previous[key] : v;
	}
	return Object.keys(out).length ? out : undefined;
}

/** Add or replace one server. `previousName` renames. Unknown fields of the saved entry are kept. */
export function saveMcpServer(agentDir: string, input: Record<string, unknown>, previousName?: string): void {
	const name = String(input.name ?? "").trim();
	if (!NAME.test(name)) throw new Error("Name: letters, digits, - and _ only (max 64)");
	const config = readConfig(agentDir);
	const before = config.mcpServers[previousName ?? name] ?? {};
	if (previousName && previousName !== name && config.mcpServers[name]) throw new Error(`A server named "${name}" already exists`);

	const kind = input.kind === "http" ? "http" : "stdio";
	const exposure = String(input.exposure ?? "direct");
	if (!EXPOSURES.includes(exposure)) throw new Error(`Exposure must be one of ${EXPOSURES.join(", ")}`);
	const server: RawServer = { ...before };
	for (const k of ["type", "command", "args", "cwd", "env", "url", "headers"]) delete server[k];
	if (kind === "stdio") {
		const command = String(input.command ?? "").trim();
		if (!command || /[\r\n\0]/.test(command)) throw new Error("Command is required (one program, e.g. npx)");
		const args = Array.isArray(input.args) ? input.args.map((a) => String(a)) : [];
		if (args.some((a) => /[\r\n\0]/.test(a))) throw new Error("Arguments can't contain line breaks");
		server.command = command;
		if (args.length) server.args = args;
		const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
		if (cwd) server.cwd = cwd;
		const env = cleanMap(input.env, before.env, "Environment variable");
		if (env) server.env = env;
	} else {
		const url = String(input.url ?? "").trim();
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error("URL is not valid");
		}
		const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
		if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) throw new Error("URL must be https:// (http only for localhost)");
		server.url = url;
		const headers = cleanMap(input.headers, before.headers, "Header");
		if (headers) server.headers = headers;
	}
	server.exposure = exposure;
	server.enabled = input.enabled !== false;
	const description = typeof input.description === "string" ? input.description.trim().slice(0, 300) : "";
	if (description) server.description = description;
	else delete server.description;

	if (previousName && previousName !== name) delete config.mcpServers[previousName];
	config.mcpServers[name] = server;
	writeConfig(agentDir, config);
}

export function removeMcpServer(agentDir: string, name: string): void {
	const config = readConfig(agentDir);
	if (!config.mcpServers[name]) throw new Error(`No server named "${name}"`);
	delete config.mcpServers[name];
	writeConfig(agentDir, config);
}

/** pi's own check (`<harness> mcp list`): connects to every enabled server and reports its state and tools. */
export function testMcpServers(command: string, args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolveTest) => {
		const child = spawn(command, [...args, "mcp", "list"], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		const timer = setTimeout(() => child.kill(), 60_000);
		child.stdout.on("data", (d: Buffer) => {
			output += d.toString("utf8");
		});
		child.stderr.on("data", (d: Buffer) => {
			output += d.toString("utf8");
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			// Drop ANSI colors and Node's experimental-feature noise.
			const clean = output
				.replace(/\x1b\[[0-9;]*m/g, "")
				.split("\n")
				.filter((l) => !/ExperimentalWarning|--trace-warnings/.test(l))
				.join("\n")
				.trim();
			resolveTest({ ok: code === 0, output: clean.slice(-6000) });
		});
		child.on("error", (e) => {
			clearTimeout(timer);
			resolveTest({ ok: false, output: e.message });
		});
	});
}
