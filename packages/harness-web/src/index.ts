import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, userInfo } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { colorToHex, parseColor } from "@earendil-works/pi-tui";
import { type HarnessSpec, listSkills, loadSpec, readSpecFile, themeName } from "@forge/harness-spec";
import { credentialStatus, harnessCredentials, updateCredentials } from "./credentials.ts";

export { applySavedCredentials, CredentialStore, credentialsFile, harnessCredentials, harnessCredentialsFile } from "./credentials.ts";

/** True inside a forge-packaged executable (Bun compiled binary): files then live next to the executable. */
export const isPackagedBinary = import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");
const BINARY_DIR = dirname(process.execPath);
const PUBLIC_DIR = isPackagedBinary ? join(BINARY_DIR, "web") : join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const PI_THEME_DIR = isPackagedBinary
	? join(BINARY_DIR, "theme")
	: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "theme");
const VIEW_FILES = new Set(["web.js", "sample.json", "view.json"]);
/** Static files of the web UI (icons come from the AI Icon Pack: icons-sprite.svg, ai-state.js). */
const PUBLIC_FILES: Record<string, string> = {
	"/app.js": "text/javascript; charset=utf-8",
	"/app.css": "text/css; charset=utf-8",
	"/ai-state.js": "text/javascript; charset=utf-8",
	"/icons-sprite.svg": "image/svg+xml",
	"/favicon.svg": "image/svg+xml",
	"/logo.svg": "image/svg+xml",
	"/logo-mark.svg": "image/svg+xml",
	"/forge-favicon.svg": "image/svg+xml",
};
const LOG_LIMIT = 5000;

export interface WebOptions {
	harnessDir: string;
	spec: HarnessSpec;
	/** The harness launcher (bin/<name>.ts); started with --mode rpc. */
	binPath: string;
	/** Extra CLI args passed to the RPC child (e.g. --no-session, --model ...). */
	args: string[];
	port?: number;
	open?: boolean;
	/** Repo templates/ folder; when present the preview page also lists every template view. */
	templatesDir?: string;
}

interface ViewEntry {
	id: string;
	dir: string;
	meta: { title?: string; description?: string; panelTitle?: string; domains?: string[] };
}

// -----------------------------------------------------------------------------
// Theme → CSS colors
// -----------------------------------------------------------------------------

export interface WebTheme {
	appearance: "dark" | "light";
	accent: string;
	border: string;
	text: string;
	muted: string;
	success: string;
	error: string;
	warning: string;
}

function toHex(value: unknown, vars: Record<string, unknown>, fallback: string, depth = 0): string {
	if (value === undefined || value === "" || depth > 8) return fallback;
	if (typeof value === "string" && value in vars) return toHex(vars[value], vars, fallback, depth + 1);
	try {
		return colorToHex(parseColor(value as string | number));
	} catch {
		return fallback;
	}
}

export function webTheme(harnessDir: string, spec: HarnessSpec): WebTheme {
	const name = themeName(spec) ?? "system";
	const candidates = [join(harnessDir, "themes", `${name}.json`), join(PI_THEME_DIR, `${name === "light" ? "light" : "dark"}.json`)];
	const file = candidates.find((f) => existsSync(f));
	const json = file
		? (JSON.parse(readFileSync(file, "utf8")) as { appearance?: string; vars?: Record<string, unknown>; colors?: Record<string, unknown> })
		: {};
	const vars = json.vars ?? {};
	const colors = json.colors ?? {};
	const dark = (json.appearance ?? "dark") !== "light";
	return {
		appearance: dark ? "dark" : "light",
		accent: toHex(colors.accent, vars, "#b48ead"),
		border: toHex(colors.border, vars, "#5c6370"),
		text: toHex(colors.text, vars, dark ? "#e3e3e3" : "#202020"),
		muted: toHex(colors.muted, vars, "#9aa0a6"),
		success: toHex(colors.success, vars, "#7fd1a7"),
		error: toHex(colors.error, vars, "#f28b82"),
		warning: toHex(colors.warning, vars, "#e5c07b"),
	};
}

// -----------------------------------------------------------------------------
// Views
// -----------------------------------------------------------------------------

function readView(dir: string, id: string): ViewEntry | undefined {
	const metaFile = join(dir, "view.json");
	if (!existsSync(metaFile)) return undefined;
	return { id, dir, meta: JSON.parse(readFileSync(metaFile, "utf8")) as ViewEntry["meta"] };
}

/**
 * Views for the preview page: the harness's own views (custom/ first, then the generated copies),
 * plus any unused custom views. forge's page also lists every template, since it picks views for others.
 */
function collectViews(harnessDir: string, spec: HarnessSpec, templatesDir?: string): { harness: ViewEntry[]; preview: ViewEntry[] } {
	const harness: ViewEntry[] = [];
	for (const use of spec.ui?.views ?? []) {
		const entry =
			readView(join(harnessDir, "custom", "views", use.id), use.id) ?? readView(join(harnessDir, "forge_modules", "views", use.id), use.id);
		if (entry) harness.push(entry);
	}
	// The built-in plan view (update_plan) is part of every generated harness.
	const planView = readView(join(harnessDir, "forge_modules", "views", "plan"), "plan");
	if (planView && !harness.some((v) => v.id === "plan")) harness.push(planView);
	const preview = [...harness];
	const showCatalog = spec.name === "forge" && templatesDir;
	const extraRoots = [join(harnessDir, "custom", "views"), showCatalog ? join(templatesDir, "views") : ""];
	for (const root of extraRoots) {
		if (!root || !existsSync(root)) continue;
		for (const id of readdirSync(root)) {
			if (preview.some((v) => v.id === id)) continue;
			const entry = readView(join(root, id), id);
			if (entry) preview.push(entry);
		}
	}
	return { harness, preview };
}

// -----------------------------------------------------------------------------
// Past chats (pi session files)
// -----------------------------------------------------------------------------

export interface SessionSummary {
	path: string;
	title: string;
	modified: number;
	messages: number;
}

/** pi groups sessions by working directory: <agentDir>/sessions/--<cwd with / \ : replaced by ->--/ */
function sessionDir(cwd: string): string | undefined {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) return undefined;
	const encoded = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
	return join(agentDir, "sessions", `--${encoded}--`);
}

function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: string; text: string } => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text")
		.map((c) => c.text)
		.join(" ");
}

export function listSessions(cwd: string, limit = 200): SessionSummary[] {
	const dir = sessionDir(cwd);
	if (!dir || !existsSync(dir)) return [];
	return listSessionsIn(dir, limit);
}

function listSessionsIn(dir: string, limit = 200): SessionSummary[] {
	const out: SessionSummary[] = [];
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
		const path = join(dir, file);
		let title = "";
		let name = "";
		let messages = 0;
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as { type?: string; name?: string; message?: { role?: string; content?: unknown } };
				if (entry.type === "session_info" && entry.name) name = entry.name;
				if (entry.type === "message" && entry.message?.role === "user") {
					messages++;
					if (!title) title = textOfContent(entry.message.content).replace(/\s+/g, " ").trim();
				}
			} catch {
				// a partially written last line; ignore
			}
		}
		if (messages === 0) continue;
		out.push({ path, title: (name || title).slice(0, 120), modified: statSync(path).mtimeMs, messages });
	}
	return out.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

// -----------------------------------------------------------------------------
// Workspace info: the person, and (for forge) the harnesses in this checkout
// -----------------------------------------------------------------------------

function currentUser(): { name: string; initials: string } {
	let name = "";
	try {
		name = execFileSync("git", ["config", "--global", "user.name"], { encoding: "utf8", timeout: 2000 }).trim();
	} catch {
		// git missing or no name configured
	}
	if (!name) name = userInfo().username;
	const words = name.split(/[\s._-]+/).filter(Boolean);
	const initials = (words.length > 1 ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}` : name.slice(0, 2)).toUpperCase();
	return { name, initials };
}

export interface HarnessSummary {
	name: string;
	title: string;
	description: string;
	model: string;
	views: string[];
	tools: number;
	/** Skills in custom/skills that pi can load */
	skills: number;
	/** Services whose keys the harness's tools need */
	keys: string[];
	path: string;
	generated: boolean;
}

/** forge only: every harness in the repo (forge/ and harnesses/*), read from their harness.yaml. */
function listHarnesses(templatesDir: string | undefined): HarnessSummary[] {
	if (!templatesDir) return [];
	const root = dirname(templatesDir);
	const dirs = [join(root, "forge")];
	const harnessesDir = join(root, "harnesses");
	if (existsSync(harnessesDir)) for (const d of readdirSync(harnessesDir)) dirs.push(join(harnessesDir, d));
	const out: HarnessSummary[] = [];
	for (const dir of dirs) {
		if (!existsSync(join(dir, "harness.yaml"))) continue;
		try {
			const spec = readSpecFile(dir) as Partial<HarnessSpec>;
			out.push({
				name: spec.name ?? "?",
				title: spec.title ?? spec.name ?? "?",
				description: spec.description ?? "",
				model: spec.model?.id ?? "default",
				views: (spec.ui?.views ?? []).map((v) => v.id),
				tools: (spec.tools?.custom ?? []).length,
				skills: listSkills(dir).filter((s) => !s.problem).length,
				keys: (spec.credentials ?? []).map((c) => c.label),
				path: relative(root, dir).replace(/\\/g, "/"),
				generated: existsSync(join(dir, ".forge", "manifest.json")),
			});
		} catch {
			// unreadable spec: skip it here; forge_validate reports it
		}
	}
	return out;
}

// -----------------------------------------------------------------------------
// Brand: custom/brand/mark.svg (logo mark) and custom/brand/wordmark.svg (optional)
// -----------------------------------------------------------------------------

export interface Brand {
	mark: boolean;
	wordmark: boolean;
	/** width / height of the wordmark, so the UI can size it */
	wordmarkRatio: number;
}

function svgBox(svg: string): { w: number; h: number; viewBox: string } {
	const vb = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 24 24";
	const [, , w = 24, h = 24] = vb.split(/[\s,]+/).map(Number);
	return { w, h, viewBox: vb };
}

function brandFile(harnessDir: string, which: "mark" | "wordmark"): string | undefined {
	const file = join(harnessDir, "custom", "brand", `${which}.svg`);
	return existsSync(file) ? file : undefined;
}

export function readBrand(harnessDir: string): Brand {
	const mark = brandFile(harnessDir, "mark");
	const wordmark = brandFile(harnessDir, "wordmark");
	const box = wordmark ? svgBox(readFileSync(wordmark, "utf8")) : { w: 1, h: 1 };
	return { mark: Boolean(mark), wordmark: Boolean(wordmark), wordmarkRatio: box.h ? box.w / box.h : 1 };
}

/** Favicon: the mark in ink on a rounded paper tile, like the logo (falls back to the generic agent icon). */
function brandFavicon(harnessDir: string): string | undefined {
	const mark = brandFile(harnessDir, "mark");
	if (!mark) return undefined;
	const ink = "#161615";
	const svg = readFileSync(mark, "utf8");
	// Marks are silhouettes: whatever colors the file uses, paint every filled or stroked shape in ink.
	const inner = svg
		.replace(/^[\s\S]*?<svg[^>]*>/, "")
		.replace(/<\/svg>\s*$/, "")
		.replace(/\b(fill|stroke)="(?!none)[^"]*"/g, `$1="${ink}"`)
		.replace(/\b(fill|stroke)\s*:\s*(?!none)[^;"]+/g, `$1:${ink}`);
	const { viewBox } = svgBox(svg);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f5f4ee"/><svg x="10" y="10" width="44" height="44" viewBox="${viewBox}" fill="${ink}" color="${ink}" shape-rendering="crispEdges">${inner}</svg></svg>`;
}

// -----------------------------------------------------------------------------
// Server
// -----------------------------------------------------------------------------

function openBrowser(url: string): void {
	const [cmd, args] =
		process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
	spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
	return new Promise((resolveBody, reject) => {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString("utf8");
			if (body.length > limit) reject(new Error("body too large"));
		});
		req.on("end", () => resolveBody(body));
		req.on("error", reject);
	});
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8"): void {
	res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
	res.end(body);
}

/**
 * The page's live view of a streaming reply. pi's RPC events carry only deltas, and the tool name only on
 * toolcall_start, so this remembers each tool call being written: its name, the file or command it targets
 * (read from the start of its arguments) and how much has been written. undefined = nothing to show.
 */
function createStreamTracker() {
	const calls = new Map<number, { name: string; head: string; chars: number }>();
	const TARGET = /"(?:path|file_path|file|command|url|query)"\s*:\s*"((?:[^"\\]|\\.){1,300})/;
	const describe = (call: { name: string; head: string; chars: number }) => {
		const raw = TARGET.exec(call.head)?.[1];
		const target = raw?.replace(/\\(["\\/])/g, "$1").replace(/\\n/g, " ");
		return { name: call.name, target: target?.slice(0, 160), chars: call.chars };
	};
	const track = (line: string): string | undefined => {
		let record: { assistantMessageEvent?: { type?: string; contentIndex?: number; delta?: string; toolName?: string } };
		try {
			record = JSON.parse(line) as typeof record;
		} catch {
			return undefined;
		}
		const e = record.assistantMessageEvent;
		if (!e?.type) return undefined;
		const index = e.contentIndex ?? -1;
		const out: Record<string, unknown> = { type: e.type, contentIndex: index };
		if (e.type === "text_delta" || e.type === "thinking_delta") out.delta = e.delta;
		else if (e.type === "toolcall_start" || e.type === "toolcall_delta" || e.type === "toolcall_end") {
			if (e.type === "toolcall_start") calls.set(index, { name: e.toolName ?? "", head: "", chars: 0 });
			const call = calls.get(index) ?? { name: "", head: "", chars: 0 };
			calls.set(index, call);
			if (e.type === "toolcall_delta" && e.delta) {
				call.chars += e.delta.length;
				if (call.head.length < 4000) call.head += e.delta;
			}
			out.tool = describe(call);
			if (e.type === "toolcall_end") calls.delete(index);
		} else if (!["text_start", "text_end", "thinking_start", "thinking_end"].includes(e.type)) return undefined;
		return JSON.stringify({ type: "message_update", assistantMessageEvent: out });
	};
	/** For a page that connects mid-run: the tool call being written right now, as a replay event. */
	const snapshot = (): string | undefined => {
		const last = [...calls.entries()].at(-1);
		if (!last) return undefined;
		return JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: last[0], tool: describe(last[1]) } });
	};
	/** A run ended: forget unfinished calls (an aborted stream never sends toolcall_end). */
	const reset = () => calls.clear();
	return { track, snapshot, reset };
}

interface ChannelOptions {
	label: string;
	command: () => { args: string[]; cwd: string };
	/** Every stdout line, before it is relayed. */
	onLine?: (line: string) => void;
	/** The agent exited without being asked to. */
	onExit: (code: number | null) => void;
}

/**
 * One agent process in RPC mode and the browsers watching it: the replay log (stamped with _ts), the live stream
 * tracker, whether a run is in progress, and the session it last reported. Started on first use.
 */
function createChannel(opts: ChannelOptions) {
	const stream = createStreamTracker();
	const log: string[] = [];
	const clients = new Set<ServerResponse>();
	let child: ChildProcessWithoutNullStreams | undefined;
	let replacing = false;
	const stamp = (record: string) => (record.endsWith("}") ? `${record.slice(0, -1)},"_ts":${Date.now()}}` : record);

	const channel = {
		busy: false,
		lastSession: undefined as string | undefined,
		onSettled: undefined as (() => void) | undefined,
		get running() {
			return child !== undefined;
		},
		publish(record: string, keep = true) {
			if (keep) {
				log.push(record);
				if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
			}
			for (const client of clients) client.write(`data: ${record}\n\n`);
		},
		start() {
			const { args, cwd } = opts.command();
			const agent = spawn(process.execPath, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
			let buffer = "";
			agent.stdout.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf8");
				let i = buffer.indexOf("\n");
				while (i >= 0) {
					const line = buffer.slice(0, i).replace(/\r$/, "");
					buffer = buffer.slice(i + 1);
					if (line.trim()) handleLine(line);
					i = buffer.indexOf("\n");
				}
			});
			agent.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
			agent.on("exit", (code) => {
				if (agent !== child || replacing) return; // a replaced agent: expected
				child = undefined;
				channel.busy = false;
				channel.publish(JSON.stringify({ type: "forge_exit", code }));
				opts.onExit(code);
			});
			child = agent;
		},
		/** Replace the agent (keys changed, harness rebuilt) and reopen the chat that was open. */
		restart(sessionPath?: string) {
			replacing = true;
			const old = child;
			channel.start();
			replacing = false;
			old?.kill();
			log.length = 0;
			channel.busy = false;
			if (sessionPath) channel.send({ id: "forge-restore", type: "switch_session", sessionPath });
			channel.publish(JSON.stringify({ type: "forge_agent_restarted" }));
		},
		stop() {
			const old = child;
			child = undefined;
			old?.kill();
		},
		send(record: unknown) {
			if (!child) channel.start();
			child?.stdin.write(`${JSON.stringify(record)}\n`);
		},
		/** A browser connects: replay what happened, then the live tool call, then live events. */
		connect(res: ServerResponse) {
			if (!child) channel.start();
			for (const record of log) res.write(`data: ${record}\n\n`);
			const live = stream.snapshot();
			if (live) res.write(`data: ${live}\n\n`);
			res.write(`data: ${JSON.stringify({ type: "forge_replay_done" })}\n\n`);
			clients.add(res);
		},
		disconnect(res: ServerResponse) {
			clients.delete(res);
		},
	};

	function handleLine(line: string): void {
		opts.onLine?.(line);
		if (line.startsWith('{"type":"response"')) {
			if (/"command":"(new_session|switch_session)"/.test(line) && /"success":true/.test(line)) log.length = 0;
			if (/"command":"get_state"/.test(line)) {
				const file = /"sessionFile":"((?:[^"\\]|\\.)*)"/.exec(line)?.[1];
				if (file) channel.lastSession = JSON.parse(`"${file}"`) as string;
			}
		}
		// Streaming updates are live-only and reduced to what the page shows. Replayed events carry the time they
		// happened (_ts), so a page that loads mid-run can show what the agent is doing and for how long; only the
		// start of each phase is kept, not every delta.
		if (line.startsWith('{"type":"message_update"')) {
			const slim = stream.track(line);
			if (slim) {
				const phaseStart = /"type":"(thinking_start|text_start|toolcall_start)"/.test(slim);
				channel.publish(phaseStart ? stamp(slim) : slim, phaseStart);
			}
			return;
		}
		if (line.startsWith('{"type":"agent_start"')) channel.busy = true;
		channel.publish(stamp(line));
		if (line.startsWith('{"type":"agent_settled"')) {
			stream.reset();
			channel.busy = false;
			channel.onSettled?.();
		}
	}

	return channel;
}

/** What pi-Forge is told in an "Add to <harness>" session. */
function builderPrompt(spec: HarnessSpec, harnessDir: string, repoRoot: string): string {
	const rel = relative(repoRoot, harnessDir).split(sep).join("/");
	const title = spec.title ?? spec.name;
	const code = (text: string) => "`" + text + "`";
	return [
		"# This session: add to " + title,
		"",
		"You are running inside the **" + title + "** harness's web UI, on its 'Add to " + title + "' page. This whole session is about",
		"extending that one harness, " + code(rel + "/") + " (spec: " + code(rel + "/harness.yaml") + "). Do not create or change any other harness.",
		"",
		"The user comes here to add capabilities: new tools, new or better views, data sources and APIs (with their keys under",
		code("credentials:") + "), skills, and fixes to existing tools. Use the " + code("harness-update") + " skill, plus " + code("tool-builder") + ",",
		code("view-builder") + " and " + code("skill-builder") + " as needed. Start by reading the spec and listing " + code("custom/") + ", so you know what exists.",
		"",
		"Work end to end: edit, forge_validate, forge_generate with apply, then forge_smoke (load check, and a live prompt that",
		"calls the new tool). When this run ends with the harness changed, the " + title + " agent reloads automatically with the",
		"new tools and views, so tell the user it's ready to try there, and how (an example request).",
	].join("\n");
}

/** Changes to a harness's spec, generated manifest or custom code, as one comparable string. */
function harnessSignature(harnessDir: string): string {
	const parts: string[] = [];
	const add = (path: string) => {
		try {
			const st = statSync(path);
			if (st.isDirectory()) {
				for (const name of readdirSync(path)) if (name !== "node_modules" && !name.startsWith(".")) add(join(path, name));
			} else parts.push(`${path}:${st.size}:${st.mtimeMs}`);
		} catch {
			// gone: counts as a change through its absence
		}
	};
	add(join(harnessDir, "harness.yaml"));
	add(join(harnessDir, ".forge", "manifest.json"));
	add(join(harnessDir, "custom"));
	return parts.join("|");
}

/** Sessions stored directly in a folder (pi's --session-dir). */
function listSessionFiles(dir: string): SessionSummary[] {
	return existsSync(dir) ? listSessionsIn(dir) : [];
}

export async function startWeb(options: WebOptions): Promise<void> {
	const { harnessDir } = options;
	let spec = options.spec;
	const token = randomBytes(16).toString("hex");
	let views = collectViews(harnessDir, spec, options.templatesDir);
	let viewById = new Map(views.preview.map((v) => [v.id, v]));
	let theme = webTheme(harnessDir, spec);

	// --- agents: the harness itself ("main") and, in a pi-Forge checkout, pi-Forge scoped to it ("builder") ----
	const main = createChannel({
		label: spec.name,
		command: () => ({
			// A packaged executable is itself the harness; otherwise run the launcher script with node.
			args: isPackagedBinary ? ["--mode", "rpc", ...options.args] : [options.binPath, "--mode", "rpc", ...options.args],
			cwd: process.cwd(),
		}),
		onExit: (code) => {
			console.log(`${spec.name} exited (${code ?? "signal"}); stopping web UI`);
			setTimeout(() => process.exit(code ?? 0), 200);
		},
	});
	main.start();

	// "Add to harness": a pi-Forge session whose only job is to extend this harness (tools, views, keys, skills).
	// Needs the repo (templates and forge/); a packaged program has neither, so the page is hidden there.
	const repoRoot = options.templatesDir ? dirname(options.templatesDir) : undefined;
	const forgeBin = repoRoot ? join(repoRoot, "forge", "bin", "forge.ts") : undefined;
	const builderAvailable = Boolean(forgeBin && existsSync(forgeBin) && spec.name !== "forge" && !isPackagedBinary);
	const builderSessions = join(process.env.FORGE_HOME ?? join(homedir(), ".forge"), spec.name, "builder-sessions");
	let harnessBefore = "";
	let pendingReload = false;
	const builder = createChannel({
		label: `pi-Forge for ${spec.name}`,
		command: () => ({
			args: [forgeBin as string, "--mode", "rpc", "--session-dir", builderSessions, "--append-system-prompt", builderPrompt(spec, harnessDir, repoRoot as string)],
			cwd: repoRoot as string,
		}),
		onLine: (line) => {
			// When a builder run changes the harness, reload it: the web UI's spec and views, then the harness's agent.
			if (line.startsWith('{"type":"agent_start"')) harnessBefore = harnessSignature(harnessDir);
			else if (line.startsWith('{"type":"agent_settled"') && harnessBefore && harnessSignature(harnessDir) !== harnessBefore) {
				harnessBefore = "";
				pendingReload = true;
				reloadHarness();
			}
		},
		onExit: () => {
			// pi-Forge stopped (crash or killed): the page says so, and the next message starts it again.
		},
	});

	/** Re-read harness.yaml and views, then restart the harness's agent so new tools load (after its current run). */
	function reloadHarness(): void {
		if (!pendingReload) return;
		if (main.busy) return; // finishes its run first; main's agent_settled calls this again
		pendingReload = false;
		try {
			spec = loadSpec(harnessDir);
			views = collectViews(harnessDir, spec, options.templatesDir);
			viewById = new Map(views.preview.map((v) => [v.id, v]));
			theme = webTheme(harnessDir, spec);
			Object.assign(config, buildConfig());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			builder.publish(JSON.stringify({ type: "forge_harness_updated", ok: false, error: message.slice(0, 600) }));
			return;
		}
		main.restart(main.lastSession);
		const summary = { type: "forge_harness_updated", ok: true, tools: config.tools.custom, views: config.views.map((v) => v.id) };
		main.publish(JSON.stringify(summary));
		builder.publish(JSON.stringify(summary));
	}
	main.onSettled = reloadHarness;

	const buildConfig = () => ({
		brand: readBrand(harnessDir),
		name: spec.name,
		title: spec.title ?? spec.name,
		description: spec.description ?? "",
		hint: spec.ui?.header?.hint ?? "",
		layout: spec.ui?.web?.layout ?? "chat-with-sidebar",
		theme,
		views: (spec.ui?.views ?? []).map((v) => ({
			...v,
			title: viewById.get(v.id)?.meta.title ?? v.id,
			panelTitle: viewById.get(v.id)?.meta.panelTitle ?? v.id,
		})),
		preview: views.preview.map((v) => ({ id: v.id, ...v.meta, inHarness: views.harness.some((h) => h.id === v.id) })),
		web: {
			headline: spec.ui?.web?.headline ?? spec.title ?? spec.name,
			subtitle: spec.ui?.web?.subtitle ?? spec.description ?? "",
			placeholder: spec.ui?.web?.placeholder ?? `Message ${spec.title ?? spec.name}…`,
			eyebrow: spec.ui?.web?.eyebrow ?? "Built with pi-Forge",
			tagline: spec.ui?.web?.tagline ?? "",
		},
		tools: { builtin: spec.tools?.builtin ?? [], custom: spec.tools?.custom ?? [], plan: spec.tools?.plan !== false },
		user: currentUser(),
		isForge: spec.name === "forge" && Boolean(options.templatesDir),
		builder: { available: builderAvailable, title: `Add to ${spec.title ?? spec.name}` },
	});
	const config = buildConfig();

	// --- HTTP ------------------------------------------------------------------------
	let port = options.port ?? 4317;
	const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

	const server = createServer(async (req, res) => {
		try {
			// DNS-rebinding guard: only answer requests addressed to this local server.
			if (!allowedHosts().has(req.headers.host ?? "")) return send(res, 403, "forbidden host");
			const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

			if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/preview" || (url.pathname === "/build" && builderAvailable))) {
				const html = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8").replace("__FORGE_TOKEN__", token);
				return send(res, 200, html, "text/html; charset=utf-8");
			}
			// Brand files: harness-owned SVGs, served with a policy that never lets them run scripts.
			const brandMatch = /^\/brand\/(mark|wordmark|favicon)\.svg$/.exec(url.pathname);
			if (req.method === "GET" && brandMatch) {
				const which = brandMatch[1] as "mark" | "wordmark" | "favicon";
				const body = which === "favicon" ? brandFavicon(harnessDir) : (() => {
					const f = brandFile(harnessDir, which);
					return f ? readFileSync(f, "utf8") : undefined;
				})();
				if (!body) return send(res, 404, "no brand file");
				res.writeHead(200, {
					"content-type": "image/svg+xml",
					"cache-control": "no-store",
					"x-content-type-options": "nosniff",
					"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
				});
				res.end(body);
				return;
			}
			const publicType = PUBLIC_FILES[url.pathname];
			if (req.method === "GET" && publicType) {
				return send(res, 200, readFileSync(join(PUBLIC_DIR, url.pathname.slice(1))), publicType);
			}
			if (req.method === "GET" && url.pathname === "/api/config") {
				return send(res, 200, JSON.stringify(config), "application/json");
			}
			const viewMatch = /^\/views\/([a-z0-9-]+)\/([a-z.]+)$/.exec(url.pathname);
			if (req.method === "GET" && viewMatch) {
				const [, id, file] = viewMatch as unknown as [string, string, string];
				// A harness can show its own example data on the preview page: custom/samples/<view>.json.
				const ownSample = join(harnessDir, "custom", "samples", `${id}.json`);
				if (file === "sample.json" && viewById.has(id) && existsSync(ownSample)) {
					return send(res, 200, readFileSync(ownSample), "application/json");
				}
				// The harness's views first; the builder page also draws pi-Forge's results, which use template views.
				const templateView = options.templatesDir ? join(options.templatesDir, "views", id) : "";
				const dir = viewById.get(id)?.dir ?? (builderAvailable && templateView && existsSync(join(templateView, "view.json")) ? templateView : undefined);
				if (!dir || !VIEW_FILES.has(file) || !existsSync(join(dir, file))) return send(res, 404, "not found");
				const type = file.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/json";
				return send(res, 200, readFileSync(join(dir, file)), type);
			}
			if (req.method === "GET" && url.pathname === "/api/events") {
				if (url.searchParams.get("token") !== token) return send(res, 401, "bad token");
				const channel = url.searchParams.get("agent") === "builder" ? builder : main;
				if (channel === builder && !builderAvailable) return send(res, 404, "no builder here");
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
				channel.connect(res);
				const ping = setInterval(() => res.write(": ping\n\n"), 15000);
				req.on("close", () => {
					clearInterval(ping);
					channel.disconnect(res);
				});
				return;
			}
			if (url.pathname === "/api/credentials") {
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				// providers: model keys shared by every harness. harness: this harness's tool keys (credentials: in its spec).
				const allStatus = () => JSON.stringify({ providers: credentialStatus(), harness: harnessCredentials(spec).status() });
				if (req.method === "GET") return send(res, 200, allStatus(), "application/json");
				if (req.method === "POST") {
					const body = JSON.parse(await readBody(req, 64_000)) as { scope?: unknown; id?: unknown; provider?: unknown; values?: unknown; sessionPath?: unknown };
					const id = typeof body.id === "string" ? body.id : body.provider;
					if (typeof id !== "string" || typeof body.values !== "object" || body.values === null || Array.isArray(body.values)) {
						return send(res, 400, "id and values required");
					}
					try {
						const values = body.values as Record<string, string | null>;
						if (body.scope === "harness") harnessCredentials(spec).update(id, values);
						else updateCredentials(id, values);
					} catch (error) {
						return send(res, 400, error instanceof Error ? error.message : String(error));
					}
					// The agent reads keys at startup: restart it and reopen the current chat.
					main.restart(typeof body.sessionPath === "string" && body.sessionPath ? body.sessionPath : undefined);
					if (builder.running) builder.restart(builder.lastSession);
					return send(res, 200, allStatus(), "application/json");
				}
				return send(res, 405, "method not allowed");
			}
			if (req.method === "GET" && url.pathname === "/api/harnesses") {
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				return send(res, 200, JSON.stringify(config.isForge ? listHarnesses(options.templatesDir) : []), "application/json");
			}
			if (req.method === "GET" && url.pathname === "/api/sessions") {
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				const list = url.searchParams.get("agent") === "builder" ? listSessionFiles(builderSessions) : listSessions(process.cwd());
				return send(res, 200, JSON.stringify(list), "application/json");
			}
			if (req.method === "POST" && url.pathname === "/api/rpc") {
				// A custom header forces a CORS preflight, so other sites cannot post commands here.
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				const record = JSON.parse(await readBody(req)) as { type?: unknown; id?: unknown };
				if (typeof record.type !== "string") return send(res, 400, "missing type");
				const channel = url.searchParams.get("agent") === "builder" ? builder : main;
				if (channel === builder && !builderAvailable) return send(res, 404, "no builder here");
				channel.send(record);
				// Lets every open tab (and replays after reload) close a dialog that was answered.
				if (record.type === "extension_ui_response") channel.publish(JSON.stringify({ type: "forge_ui_answered", id: record.id }));
				return send(res, 200, '{"ok":true}', "application/json");
			}
			return send(res, 404, "not found");
		} catch (error) {
			return send(res, 500, error instanceof Error ? error.message : String(error));
		}
	});

	await new Promise<void>((resolveListen, reject) => {
		const attempt = (tries: number) => {
			server.once("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "EADDRINUSE" && tries < 20) {
					port += 1;
					attempt(tries + 1);
				} else reject(error);
			});
			server.listen(port, "127.0.0.1", () => resolveListen());
		};
		attempt(0);
	});

	const url = `http://127.0.0.1:${port}/`;
	console.log(`${config.title} web UI: ${url}   (view previews: ${url}preview)   Ctrl+C to stop`);
	if (options.open !== false) openBrowser(url);

	const stop = () => {
		main.stop();
		builder.stop();
		server.close();
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}
