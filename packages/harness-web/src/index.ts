import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { userInfo } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { colorToHex, parseColor } from "@earendil-works/pi-tui";
import { type HarnessSpec, readSpecFile, themeName } from "@forge/harness-spec";
import { credentialStatus, updateCredentials } from "./credentials.ts";

export { applySavedCredentials, credentialsFile } from "./credentials.ts";

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

export async function startWeb(options: WebOptions): Promise<void> {
	const { harnessDir, spec } = options;
	const token = randomBytes(16).toString("hex");
	const views = collectViews(harnessDir, spec, options.templatesDir);
	const viewById = new Map(views.preview.map((v) => [v.id, v]));
	const theme = webTheme(harnessDir, spec);

	// --- the harness, in RPC mode ------------------------------------------------
	const log: string[] = [];
	const clients = new Set<ServerResponse>();
	const publish = (record: string) => {
		log.push(record);
		if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
		for (const client of clients) client.write(`data: ${record}\n\n`);
	};

	let child: ChildProcessWithoutNullStreams;
	let restarting = false;

	/** Start the agent. It inherits process.env, so saved provider keys apply to every new agent process. */
	function startAgent(): void {
		// A packaged executable is itself the harness; otherwise run the launcher script with node.
		const agentArgs = isPackagedBinary ? ["--mode", "rpc", ...options.args] : [options.binPath, "--mode", "rpc", ...options.args];
		const agent = spawn(process.execPath, agentArgs, {
			cwd: process.cwd(),
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffer = "";
		agent.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			let i = buffer.indexOf("\n");
			while (i >= 0) {
				const line = buffer.slice(0, i).replace(/\r$/, "");
				buffer = buffer.slice(i + 1);
				if (line.trim()) {
					if (/"type":"response"/.test(line) && /"command":"(new_session|switch_session)"/.test(line) && /"success":true/.test(line)) log.length = 0;
					publish(line);
				}
				i = buffer.indexOf("\n");
			}
		});
		agent.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
		agent.on("exit", (code) => {
			if (agent !== child || restarting) return; // a replaced agent: expected
			publish(JSON.stringify({ type: "forge_exit", code }));
			console.log(`${spec.name} exited (${code ?? "signal"}); stopping web UI`);
			setTimeout(() => process.exit(code ?? 0), 200);
		});
		child = agent;
	}

	/** Replace the agent (e.g. after provider keys change) and reopen the chat that was open. */
	function restartAgent(sessionPath: string | undefined): void {
		restarting = true;
		const old = child;
		startAgent();
		restarting = false;
		old.kill();
		log.length = 0;
		if (sessionPath) toChild({ id: "forge-restore", type: "switch_session", sessionPath });
		publish(JSON.stringify({ type: "forge_agent_restarted" }));
	}

	const toChild = (record: unknown) => child.stdin.write(`${JSON.stringify(record)}\n`);
	startAgent();

	const brand = readBrand(harnessDir);
	const config = {
		brand,
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
	};

	// --- HTTP ------------------------------------------------------------------------
	let port = options.port ?? 4317;
	const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

	const server = createServer(async (req, res) => {
		try {
			// DNS-rebinding guard: only answer requests addressed to this local server.
			if (!allowedHosts().has(req.headers.host ?? "")) return send(res, 403, "forbidden host");
			const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

			if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/preview")) {
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
				const view = viewById.get(id);
				if (!view || !VIEW_FILES.has(file) || !existsSync(join(view.dir, file))) return send(res, 404, "not found");
				const type = file.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/json";
				return send(res, 200, readFileSync(join(view.dir, file)), type);
			}
			if (req.method === "GET" && url.pathname === "/api/events") {
				if (url.searchParams.get("token") !== token) return send(res, 401, "bad token");
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
				for (const record of log) res.write(`data: ${record}\n\n`);
				res.write(`data: ${JSON.stringify({ type: "forge_replay_done" })}\n\n`);
				clients.add(res);
				const ping = setInterval(() => res.write(": ping\n\n"), 15000);
				req.on("close", () => {
					clearInterval(ping);
					clients.delete(res);
				});
				return;
			}
			if (url.pathname === "/api/credentials") {
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				if (req.method === "GET") return send(res, 200, JSON.stringify(credentialStatus()), "application/json");
				if (req.method === "POST") {
					const body = JSON.parse(await readBody(req, 64_000)) as { provider?: unknown; values?: unknown; sessionPath?: unknown };
					if (typeof body.provider !== "string" || typeof body.values !== "object" || body.values === null) return send(res, 400, "provider and values required");
					try {
						updateCredentials(body.provider, body.values as Record<string, string | null>);
					} catch (error) {
						return send(res, 400, error instanceof Error ? error.message : String(error));
					}
					// The agent reads keys at startup: restart it and reopen the current chat.
					restartAgent(typeof body.sessionPath === "string" && body.sessionPath ? body.sessionPath : undefined);
					return send(res, 200, JSON.stringify(credentialStatus()), "application/json");
				}
				return send(res, 405, "method not allowed");
			}
			if (req.method === "GET" && url.pathname === "/api/harnesses") {
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				return send(res, 200, JSON.stringify(config.isForge ? listHarnesses(options.templatesDir) : []), "application/json");
			}
			if (req.method === "GET" && url.pathname === "/api/sessions") {
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				return send(res, 200, JSON.stringify(listSessions(process.cwd())), "application/json");
			}
			if (req.method === "POST" && url.pathname === "/api/rpc") {
				// A custom header forces a CORS preflight, so other sites cannot post commands here.
				if (req.headers["x-forge-token"] !== token) return send(res, 401, "bad token");
				const record = JSON.parse(await readBody(req)) as { type?: unknown; id?: unknown };
				if (typeof record.type !== "string") return send(res, 400, "missing type");
				toChild(record);
				// Lets every open tab (and replays after reload) close a dialog that was answered.
				if (record.type === "extension_ui_response") publish(JSON.stringify({ type: "forge_ui_answered", id: record.id }));
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
		child.kill();
		server.close();
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}
