// forge web UI. Talks to the harness's RPC mode: events arrive over SSE, commands go out by POST.
// Chats are pi session files; the transcript is loaded with get_messages and then kept live from events.

const token = document.querySelector('meta[name="forge-token"]').content;
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
};

// ---------------------------------------------------------------------------
// Icons: AI Icon Pack (Spark style) from /icons-sprite.svg, plus the morphing <ai-state> status icon
// ---------------------------------------------------------------------------

import "/ai-state.js";

/** UI name → icon pack name. Every icon has an outline and a "-filled" version in the sprite. */
const ICONS = {
	home: "home",
	layers: "layers",
	views: "layout-grid",
	panel: "panel-right-open",
	info: "info-circle",
	search: "search",
	edit: "chat-new",
	chat: "chat",
	plus: "plus",
	arrow: "arrow-up",
	stop: "stop-generating",
	chevron: "chevron-down",
	dots: "menu-dots",
	menu: "menu",
	check: "check",
	command: "command",
	skill: "prompt-library",
	prompt: "prompt-template",
	compress: "context-window",
	copy: "copy",
	rename: "edit",
	model: "model",
	tool: "tool-use",
	agent: "agent",
	close: "x",
};
function icon(name, filled = false) {
	const id = `icon-${ICONS[name] ?? name}${filled ? "-filled" : ""}`;
	return `<svg class="i" aria-hidden="true"><use href="/icons-sprite.svg#${id}"/></svg>`;
}
function paintIcons(root = document) {
	for (const node of root.querySelectorAll("[data-icon]")) {
		if (!node.dataset.painted) {
			node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon));
			node.dataset.painted = "1";
		}
	}
}
paintIcons();

/** The morphing status icon. States: idle, thinking, searching, working, generating, done, error, paused. */
function aiState(state, size, opts = {}) {
	const node = document.createElement("ai-state");
	node.setAttribute("state", state);
	node.setAttribute("size", String(size));
	if (opts.gradient) node.setAttribute("gradient", "");
	if (opts.live === false) node.setAttribute("live", "false");
	return node;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function rpc(record) {
	const res = await fetch(`/api/rpc${AGENT_QUERY}`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-forge-token": token },
		body: JSON.stringify(record),
	});
	if (!res.ok) toast(`Command failed: ${await res.text()}`, "error");
}

// Commands with an id resolve when their response arrives on the event stream.
let callSeq = 0;
const calls = new Map();
function call(command) {
	const id = `web-${++callSeq}`;
	return new Promise((resolve) => {
		calls.set(id, resolve);
		setTimeout(() => {
			if (calls.delete(id)) resolve({ success: false, error: "timed out" });
		}, 20000);
		rpc({ ...command, id });
	});
}

function toast(message, kind = "info") {
	const t = el("div", `toast ${kind}`, message);
	$("#toasts").append(t);
	setTimeout(() => t.remove(), kind === "error" ? 9000 : 5000);
}

// ---------------------------------------------------------------------------
// Scripts, markdown, views
// ---------------------------------------------------------------------------

const MARKED = "https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js";
const PURIFY = "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js";
const scripts = new Map();
function loadScript(src) {
	if (!scripts.has(src)) {
		scripts.set(
			src,
			new Promise((resolve, reject) => {
				const s = document.createElement("script");
				s.src = src;
				s.onload = () => resolve();
				s.onerror = () => {
					scripts.delete(src);
					reject(new Error(`failed to load ${src}`));
				};
				document.head.append(s);
			}),
		);
	}
	return scripts.get(src);
}

let markdownReady = null;
function renderMarkdown(target, text) {
	target.textContent = text;
	markdownReady ??= Promise.all([loadScript(MARKED), loadScript(PURIFY)]).catch(() => null);
	markdownReady.then((ok) => {
		if (!ok || !target.isConnected) return;
		target.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text));
		for (const table of target.querySelectorAll("table")) {
			const wrap = el("div", "table-wrap");
			table.replaceWith(wrap);
			wrap.append(table);
		}
		for (const a of target.querySelectorAll("a")) {
			a.target = "_blank";
			a.rel = "noopener";
		}
		keepAtBottom();
	});
}

const viewModules = new Map();
function loadView(id) {
	if (!viewModules.has(id)) viewModules.set(id, import(`/views/${id}/web.js`));
	return viewModules.get(id);
}

function textOf(content) {
	if (typeof content === "string") return content;
	return (content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

// ---------------------------------------------------------------------------
// Config and theme
// ---------------------------------------------------------------------------

const config = await (await fetch("/api/config")).json();
// "Add to <harness>" (/build): the same app, talking to pi-Forge scoped to this harness instead of the harness itself.
const BUILD = location.pathname === "/build" && Boolean(config.builder?.available);
const AGENT_QUERY = BUILD ? "?agent=builder" : "";
const root = document.documentElement;
const t = config.theme;
// The harness accent colors the send button and highlights; everything else is the system palette.
if (t.accent) root.style.setProperty("--accent", t.accent);
const css = getComputedStyle(root);
const viewTheme = {
	accent: t.accent,
	fg: css.getPropertyValue("--fg").trim(),
	muted: css.getPropertyValue("--muted").trim(),
	border: t.border,
	bg: css.getPropertyValue("--bg").trim(),
	panel: css.getPropertyValue("--surface-2").trim(),
	dark: t.appearance !== "light",
};
document.title = config.title;
$("#title").textContent = config.title;
/** A brand SVG painted in the current text color (ink on paper, paper on ink). */
function brandShape(which, cls, height) {
	const node = el("span", `brand-shape ${cls}`);
	node.style.setProperty("--shape", `url(/brand/${which}.svg)`);
	node.style.height = `${height}px`;
	node.style.width = which === "wordmark" ? `${Math.round(height * (config.brand.wordmarkRatio || 1))}px` : `${height}px`;
	node.setAttribute("role", "img");
	node.setAttribute("aria-label", config.title);
	return node;
}
if (config.brand?.wordmark) {
	$("#title").replaceChildren(brandShape("wordmark", "brand-wordmark", 30));
	document.querySelector(".brand-mark").hidden = true;
} else if (config.brand?.mark) {
	document.querySelector(".brand-mark").replaceChildren(brandShape("mark", "", 26));
}
if (config.brand?.mark) $("#favicon").href = "/brand/favicon.svg";
$("#avatar").textContent = config.user?.initials ?? "··";
$("#avatar").title = config.user?.name ?? "";
$("#input").placeholder = config.web?.placeholder ?? "Message…";

// Appearance override (per browser): system follows the harness theme.
const APPEARANCE_KEY = "forge-ui-appearance";
function readAppearance() {
	try {
		const v = localStorage.getItem(APPEARANCE_KEY);
		return v === "dark" || v === "auto" ? v : "light";
	} catch {
		return "light";
	}
}
function applyAppearance(value) {
	try {
		localStorage.setItem(APPEARANCE_KEY, value);
	} catch {
		// storage unavailable: the choice lasts for this page only
	}
	// Paper (the poster palette) is the default; Ink is the dark variant; Auto follows the OS.
	const dark = value === "dark" || (value === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	root.classList.toggle("dark", dark);
	viewTheme.dark = dark;
	viewTheme.fg = getComputedStyle(root).getPropertyValue("--fg").trim();
	viewTheme.muted = getComputedStyle(root).getPropertyValue("--muted").trim();
	viewTheme.bg = getComputedStyle(root).getPropertyValue("--bg").trim();
	viewTheme.panel = getComputedStyle(root).getPropertyValue("--surface-2").trim();
}
applyAppearance(readAppearance());

function viewCtx() {
	return { theme: viewTheme, expanded: true, loadScript, openView: (viewId, value) => send(`Show ${value} in the ${viewId} view.`) };
}

async function renderView(target, viewId, data) {
	try {
		const mod = await loadView(viewId);
		target.replaceChildren();
		mod.render(target, data, viewCtx());
		keepAtBottom();
	} catch (error) {
		target.replaceChildren(el("pre", "out", `view "${viewId}" failed: ${error.message}`));
	}
}

// ---------------------------------------------------------------------------
// Layout state: chat or a workspace page (harnesses, views, tools), sidebar, side card
// ---------------------------------------------------------------------------

const app = $("#app");
const main = $("#main");
const chat = $("#chat");
const scroller = $("#scroller");
// The harness's pinned panels show its own results, so not on the builder page.
const panelViews = new Map(BUILD ? [] : config.views.filter((v) => v.panel).map((v) => [v.id, v]));
let mode = "chat"; // chat | harnesses | views | tools
let chatTitle = "New chat";
let panelsOpen = window.innerWidth >= 1300;
let panelsTouched = false; // the user toggled the side card themselves

const PAGES = {
	harnesses: { title: "Harnesses", nav: "#go-harnesses" },
	views: { title: config.isForge ? "View catalog" : "Views", nav: "#go-views" },
	tools: { title: "Tools", nav: "#go-tools" },
	schedules: { title: "Schedules", nav: "#go-schedules" },
	settings: { title: "Settings", nav: null },
};
$("#go-harnesses").hidden = !config.isForge;
$("#go-tools").hidden = config.isForge;
$("#go-build").hidden = !config.builder?.available;
$("#go-schedules").hidden = config.isForge || BUILD;
$("#go-schedules").onclick = () => setMode("schedules");
$("#go-build-label").textContent = config.builder?.title ?? "Add to harness";
$("#go-build").classList.toggle("active", BUILD);
$("#go-back").hidden = !BUILD;
$("#go-back-label").textContent = `Back to ${config.title}`;
$("#go-build").onclick = () => {
	if (BUILD) setMode("chat");
	else location.href = "/build";
};
$("#go-back").onclick = () => {
	location.href = "/";
};
app.classList.toggle("build-mode", BUILD);
if (BUILD) {
	$("#crumb-root").textContent = config.builder.title;
	$("#input").placeholder = `Describe a tool, view or data source to add to ${config.title}…`;
	document.title = `${config.builder.title} · pi-Forge`;
}

function setCrumb(text) {
	$("#chat-title").textContent = text;
}

function setMode(next) {
	mode = next;
	for (const [key, page] of Object.entries(PAGES)) if (page.nav) $(page.nav).classList.toggle("active", next === key);
	$("#settings").classList.toggle("on", next === "settings");
	chat.hidden = next !== "chat";
	$("#composer").hidden = next !== "chat";
	$("#page").hidden = next === "chat";
	if (next === "chat") setCrumb(chatTitle);
	else {
		setCrumb(PAGES[next].title);
		renderPage(next);
		scroller.scrollTop = 0;
	}
	updateSide();
	history.replaceState(null, "", BUILD ? "/build" : next === "views" ? "/preview" : "/");
}

/** The side card has something to show: a plan, outputs, panel views, or extension widgets. */
function sideHasContent() {
	return plan !== null || outputs.size > 0 || panelViews.size > 0 || [...widgets.keys()].some((k) => !k.startsWith("forge-"));
}

function updateSide() {
	const has = sideHasContent();
	const welcome = Boolean(chat.querySelector(".welcome"));
	main.classList.toggle("with-panels", has && panelsOpen && mode === "chat" && !welcome);
	$("#toggle-panels").hidden = !has || mode !== "chat";
	$("#toggle-panels").classList.toggle("on", panelsOpen);
	$("#toggle-panels").innerHTML = icon("panel", panelsOpen);
}

function togglePanels(force) {
	panelsOpen = force ?? !panelsOpen;
	updateSide();
}
$("#toggle-panels").onclick = () => {
	panelsTouched = true;
	togglePanels();
};
$("#go-harnesses").onclick = () => setMode("harnesses");
$("#go-views").onclick = () => setMode("views");
$("#go-tools").onclick = () => setMode("tools");
$("#crumb-root").onclick = () => setMode("chat");
$("#open-sidebar").onclick = () => app.classList.toggle("sidebar-open");
for (const b of document.querySelectorAll(".side-nav .nav-item")) b.addEventListener("click", () => app.classList.remove("sidebar-open"));

$("#help").onclick = () => {
	const form = $("#dialog-form");
	const kv = el("dl", "kv");
	const rows = [
		["Send", "Enter"],
		["New line", "Shift + Enter"],
		["Stop the agent", "Esc, or the stop button"],
		["Steer while it works", "Type and send; it reads it after the current step"],
		["Commands and skills", "+ in the message box"],
	];
	for (const [k, v] of rows) kv.append(el("dt", "", k), el("dd", "", v));
	const about = [config.description, config.hint].filter(Boolean).map((l) => el("div", "muted", l));
	const row = el("div", "row");
	row.append(button("Close", "btn primary", () => $("#dialog").close()));
	form.replaceChildren(el("h2", "", `${config.title} help`), ...about, kv, row);
	$("#dialog").showModal();
};

$("#settings").onclick = () => {
	app.classList.remove("sidebar-open");
	setMode("settings");
};

function panelPlaceholder(v) {
	return el("div", "placeholder", `Appears when ${v.shows.join(" or ")} runs.`);
}
for (const [id, v] of panelViews) {
	const panel = el("div", "panel");
	panel.id = `panel-${id}`;
	panel.append(el("h3", "", v.panelTitle ?? v.title ?? id));
	const body = el("div", "body");
	body.append(panelPlaceholder(v));
	panel.append(body);
	$("#panels").append(panel);
}

// ---------------------------------------------------------------------------
// Side card: Plan and Outputs
// ---------------------------------------------------------------------------

let plan = null; // latest PlanData
const outputs = new Map(); // path -> { added, removed }

function showPlan(data) {
	plan = data && data.steps?.length ? data : null;
	const section = $("#ctx-plan");
	section.hidden = !plan;
	if (plan) {
		const done = plan.steps.filter((s) => s.status === "done").length;
		const total = plan.steps.filter((s) => s.status !== "skipped").length;
		$("#ctx-plan-count").textContent = `${done}/${total}`;
		renderView($("#ctx-plan-body"), "plan", plan);
		if (!panelsTouched && window.innerWidth >= 1250) panelsOpen = true;
	}
	updateSide();
	updateWorkedLabel();
}

function lineCount(text) {
	if (typeof text !== "string" || text.length === 0) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** +/- lines a write/edit call made (an estimate from its arguments, like a diff stat). */
function fileChange(name, args) {
	if (!args || typeof args.path !== "string") return undefined;
	if (name === "write") return { path: args.path, added: lineCount(args.content), removed: 0 };
	if (name === "edit") {
		const edits = Array.isArray(args.edits) ? args.edits : [{ oldText: args.oldText, newText: args.newText }];
		let added = 0;
		let removed = 0;
		for (const e of edits) {
			added += lineCount(e.newText);
			removed += lineCount(e.oldText);
		}
		return { path: args.path, added, removed };
	}
	return undefined;
}

function splitPath(path) {
	const norm = path.replace(/\\/g, "/");
	const i = norm.lastIndexOf("/");
	return i < 0 ? { dir: "", base: norm } : { dir: norm.slice(0, i + 1), base: norm.slice(i + 1) };
}

function stat(added, removed) {
	const s = el("span", "stat");
	s.append(el("span", "add", `+${added}`), el("span", "del", ` -${removed}`));
	return s;
}

function fileRow(path, change, copyable = false) {
	const row = el("div", "file-row");
	const { dir, base } = splitPath(path);
	const name = el("span", "file-name");
	name.append(el("b", "", base), el("span", "dir", dir ? ` ${dir}` : ""));
	name.title = path;
	row.append(name, stat(change.added, change.removed));
	if (copyable) {
		row.classList.add("copyable");
		row.onclick = () => navigator.clipboard.writeText(path).then(() => toast(`Copied ${path}`));
	}
	return row;
}

function renderOutputs() {
	const section = $("#ctx-outputs");
	section.hidden = outputs.size === 0;
	const body = $("#ctx-outputs-body");
	body.replaceChildren();
	for (const [path, change] of [...outputs].reverse()) {
		const row = fileRow(path, change, true);
		row.prepend(Object.assign(el("span", "row-icon"), { innerHTML: icon("file") }));
		body.append(row);
	}
	updateSide();
}

// ---------------------------------------------------------------------------
// Workspace pages: Harnesses (forge), Views, Tools
// ---------------------------------------------------------------------------

function pageHead(title, sub) {
	const head = el("div", "page-head");
	head.append(el("h1", "", title));
	if (sub) head.append(el("p", "", sub));
	return head;
}

/** A copyable command line. */
function cmd(text) {
	const c = el("div", "cmd");
	c.title = "Copy";
	c.append(el("span", "", text));
	c.insertAdjacentHTML("beforeend", icon("copy"));
	c.onclick = () => navigator.clipboard.writeText(text).then(() => toast("Copied"));
	return c;
}

function iconSpan(cls, name) {
	const s = el("span", cls);
	s.innerHTML = icon(name);
	return s;
}

// ---------------------------------------------------------------------------
// Settings: appearance, model providers (keys), about
// ---------------------------------------------------------------------------

function section(title, sub) {
	const box = el("section", "settings-section");
	const head = el("div", "settings-head");
	head.append(el("h2", "", title));
	if (sub) head.append(el("p", "", sub));
	box.append(head);
	return box;
}

async function renderSettings(page) {
	page.replaceChildren(pageHead("Settings", "Applies to pi-Forge and every harness on this computer."));

	// Appearance
	const appearance = section("Appearance");
	const seg = el("div", "seg");
	const currentLook = readAppearance();
	for (const [value, label, iconName] of [
		["light", "Paper", "light-mode"],
		["dark", "Ink", "dark-mode"],
		["auto", "Auto", "settings"],
	]) {
		const b = el("button", value === currentLook ? "on" : "");
		b.type = "button";
		b.insertAdjacentHTML("beforeend", icon(iconName));
		b.append(label);
		b.onclick = () => {
			applyAppearance(value);
			for (const other of seg.children) other.classList.toggle("on", other === b);
		};
		seg.append(b);
	}
	appearance.append(seg);

	// Safety: sandbox mode
	const safety = section(
		"Safety",
		`How much ${config.title}'s agent may touch on this computer. Applies to chats, scheduled runs and headless use. Saving restarts the agent.`,
	);
	const safetyBox = el("div", "safety-box");
	safety.append(safetyBox);
	renderSafety(safetyBox);

	// This harness's keys (credentials: in its harness.yaml)
	const harnessKeys = section(
		`${config.title} keys`,
		`Keys and settings ${config.title}'s tools need. Stored only on this computer (~/.forge/${config.name}/credentials.json), given to this harness alone. Saving restarts the agent; the open chat continues.`,
	);
	const harnessGrid = el("div", "provider-grid");
	harnessKeys.append(harnessGrid);
	harnessKeys.hidden = true;

	// MCP servers (this harness's own mcp.json)
	const mcp = section(
		"MCP servers",
		`Connect ${config.title} to MCP servers (GitHub, databases, Figma, Slack…): their tools become the agent's tools. Saved for this harness only (~/.forge/${config.name}/mcp.json). Saving restarts the agent; the open chat continues.`,
	);
	const mcpBox = el("div", "mcp-box");
	mcp.append(mcpBox);
	renderMcp(mcpBox);

	// Usage (all chats of this harness on this computer)
	const usage = section("Usage", "Tokens and estimated cost of this harness's chats on this computer, at each model's list price.");
	const usageGrid = el("div", "usage-grid");
	usage.append(usageGrid);

	// Model providers
	const providers = section(
		"Model providers",
		"Keys are stored only on this computer (~/.forge/credentials.json) and override the same variables from your shell. Saving restarts the agent; the open chat continues.",
	);
	const grid = el("div", "provider-grid");
	providers.append(grid);

	// About
	const about = section("About");
	const kv = el("dl", "kv");
	kv.append(el("dt", "", "You"), el("dd", "", config.user?.name ?? ""));
	kv.append(el("dt", "", "Harness"), el("dd", "", `${config.title} (${config.name})`));
	about.append(kv);

	page.append(appearance, safety, harnessKeys, mcp, providers, usage, about);
	fetch("/api/usage", { headers: { "x-forge-token": token } })
		.then((r) => (r.ok ? r.json() : null))
		.then((u) => {
			if (!u) return;
			for (const [label, b] of [
				["Today", u.today],
				["This month", u.month],
				["All time", u.total],
			]) {
				const card = el("div", "usage-card");
				card.append(el("span", "usage-label", label), el("b", "", fmtCost(b.cost)), el("span", "usage-sub", `${fmtTokens(b.tokens)} tokens · ${b.chats} chat${b.chats === 1 ? "" : "s"}`));
				usageGrid.append(card);
			}
			if (u.byModel.length) {
				const table = el("div", "usage-models");
				for (const m of u.byModel) {
					const row = el("div", "usage-row");
					row.append(el("span", "", m.model), el("span", "", `${fmtTokens(m.tokens)} tokens`), el("b", "", fmtCost(m.cost)));
					table.append(row);
				}
				usage.append(table);
			}
		})
		.catch(() => {});

	const [statusRes, models] = await Promise.all([
		fetch("/api/credentials", { headers: { "x-forge-token": token } }),
		call({ type: "get_available_models" }),
	]);
	const status = statusRes.ok ? await statusRes.json() : { providers: [], harness: [] };
	const counts = {};
	for (const m of models.success ? (models.data.models ?? []) : []) counts[m.provider] = (counts[m.provider] ?? 0) + 1;
	for (const p of status.providers ?? []) grid.append(providerCard(p, counts[p.id] ?? 0));
	for (const g of status.harness ?? []) harnessGrid.append(providerCard(g, 0, "harness"));
	harnessKeys.hidden = !(status.harness ?? []).length;
	if (pendingSettingsFocus === "keys" && !harnessKeys.hidden) harnessKeys.scrollIntoView({ block: "start" });
	pendingSettingsFocus = "";
}

let pendingSettingsFocus = "";

// ---------------------------------------------------------------------------
// Schedules page
// ---------------------------------------------------------------------------

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function schedulesRequest(body) {
	const res = await fetch("/api/schedules", {
		method: body ? "POST" : "GET",
		headers: { "content-type": "application/json", "x-forge-token": token },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

function fmtWhen(ms) {
	if (!ms) return "";
	const d = new Date(ms);
	const today = new Date();
	const sameDay = d.toDateString() === today.toDateString();
	const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	return sameDay ? `today ${time}` : `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

let schedulesRender = 0;

async function renderSchedules(page, editing) {
	// Clicks and run events can both refresh the page; only the latest refresh draws.
	const mine = ++schedulesRender;
	let data;
	try {
		data = await schedulesRequest();
	} catch (error) {
		if (mine === schedulesRender) page.replaceChildren(pageHead("Schedules", ""), el("p", "note", `Could not read schedules: ${error.message}`));
		return;
	}
	if (mine !== schedulesRender || mode !== "schedules") return;
	page.replaceChildren(
		pageHead("Schedules", `Prompts ${config.title} runs on its own while its web UI is running. Each run is saved as a chat.`),
	);
	const grid = el("div", "grid");
	if (editing === "") grid.append(scheduleForm(page));
	for (const sc of data.schedules) grid.append(editing === sc.id ? scheduleForm(page, sc) : scheduleCard(page, sc));
	if (!data.schedules.length && editing !== "") {
		const empty = el("div", "card wide");
		empty.append(
			el("b", "", "No schedules yet"),
			el("p", "", `For example: "Every weekday at 08:00, summarize what changed since yesterday". ${config.title} runs it and saves the answer as a chat.`),
		);
		grid.append(empty);
	}
	const actions = el("div", "card-actions");
	if (editing === undefined) actions.append(button("New schedule", "btn primary small", () => renderSchedules(page, "")));
	page.append(actions, grid);
	const help = el("p", "note schedule-help");
	help.append(
		"Runs happen only while this harness's web UI is running, and use its Safety setting (a command that needs your OK is skipped). To run one when the UI is closed, add this command to Task Scheduler or cron: ",
		el("code", "", data.command),
	);
	page.append(help);
}

function scheduleCard(page, sc) {
	const card = el("div", "card");
	const head = el("div", "card-head");
	head.append(iconSpan("c-icon", "timer"), el("b", "", sc.name), el("span", `badge${sc.running ? " warn" : sc.enabled ? " ok" : ""}`, sc.running ? "Running" : sc.enabled ? "On" : "Off"));
	card.append(head, el("p", "schedule-prompt", sc.prompt));
	const meta = el("div", "meta");
	meta.append(el("span", "chip", sc.when));
	if (sc.enabled && sc.next) meta.append(el("span", "chip", `next: ${fmtWhen(sc.next)}`));
	if (sc.lastRun) meta.append(el("span", `chip${sc.lastRun.ok ? "" : " bad"}`, `last: ${fmtWhen(sc.lastRun.at)} · ${sc.lastRun.ok ? "done" : "failed"}${sc.lastRun.cost ? ` · ${fmtCost(sc.lastRun.cost)}` : ""}`));
	card.append(meta);
	if (sc.lastRun?.error) card.append(el("p", "note", sc.lastRun.error));
	const actions = el("div", "card-actions");
	if (sc.lastRun?.sessionPath) actions.append(button("Open last run", "btn small", () => openSession(sc.lastRun.sessionPath)));
	actions.append(
		button("Run now", "btn small", async () => {
			try {
				await schedulesRequest({ action: "run", id: sc.id });
				renderSchedules(page);
			} catch (error) {
				toast(error.message, "warning");
			}
		}),
		button("Edit", "btn small", () => renderSchedules(page, sc.id)),
		button(sc.enabled ? "Turn off" : "Turn on", "btn small", async () => {
			await schedulesRequest({ action: "save", schedule: { ...sc, enabled: !sc.enabled } }).catch((e) => toast(e.message, "error"));
			renderSchedules(page);
		}),
		button("Remove", "btn small", async () => {
			await schedulesRequest({ action: "remove", id: sc.id }).catch((e) => toast(e.message, "error"));
			renderSchedules(page);
		}),
	);
	card.append(actions);
	return card;
}

function scheduleForm(page, sc) {
	const card = el("div", "card wide schedule-form");
	card.append(el("b", "", sc ? `Edit ${sc.name}` : "New schedule"));
	const field = (label, input) => {
		const l = el("label", "field");
		l.append(el("span", "field-label", label), input);
		return l;
	};
	const name = Object.assign(el("input"), { value: sc?.name ?? "", placeholder: "Morning summary" });
	const prompt = Object.assign(el("textarea"), { value: sc?.prompt ?? "", rows: 4, placeholder: `What should ${config.title} do each time?` });
	const repeat = el("select");
	for (const [v, l] of [
		["daily", "Every day"],
		["weekdays", "Weekdays (Mon-Fri)"],
		["weekly", "Every week"],
		["hourly", "Every few hours"],
	]) repeat.append(Object.assign(el("option", "", l), { value: v, selected: (sc?.repeat ?? "daily") === v }));
	const time = Object.assign(el("input"), { type: "time", value: sc?.time ?? "09:00" });
	const day = el("select");
	DAYS.forEach((d, i) => day.append(Object.assign(el("option", "", d), { value: String(i), selected: (sc?.day ?? 1) === i })));
	const every = Object.assign(el("input"), { type: "number", min: 1, max: 168, value: String(sc?.every ?? 4) });
	const timeField = field("At", time);
	const dayField = field("On", day);
	const everyField = field("Every (hours)", every);
	const sync = () => {
		timeField.hidden = repeat.value === "hourly";
		dayField.hidden = repeat.value !== "weekly";
		everyField.hidden = repeat.value !== "hourly";
	};
	repeat.onchange = sync;
	sync();
	const when = el("div", "schedule-when");
	when.append(field("Repeat", repeat), dayField, timeField, everyField);
	card.append(field("Name", name), field("Prompt", prompt), when);
	const actions = el("div", "card-actions");
	actions.append(
		button("Save", "btn primary small", async () => {
			try {
				await schedulesRequest({
					action: "save",
					schedule: { id: sc?.id, name: name.value, prompt: prompt.value, repeat: repeat.value, time: time.value, day: Number(day.value), every: Number(every.value), enabled: sc?.enabled ?? true },
				});
				toast("Schedule saved.");
				renderSchedules(page);
			} catch (error) {
				toast(`Could not save: ${error.message}`, "error");
			}
		}),
		button("Cancel", "btn small", () => renderSchedules(page)),
	);
	card.append(actions);
	setTimeout(() => name.focus(), 0);
	return card;
}

// ---------------------------------------------------------------------------
// Safety: sandbox mode (Settings)
// ---------------------------------------------------------------------------

const SANDBOX_MODES = [
	["off", "Off", "Guards from the harness spec only. The agent works with your user's permissions."],
	["workspace", "Workspace only", "File tools stay inside the workspace folder, and every shell command needs your OK (blocked in scheduled and headless runs)."],
	["read-only", "Read-only", "The agent can read inside the workspace folder, but can't write files or run shell commands."],
];

async function renderSafety(box) {
	let current;
	try {
		const res = await fetch("/api/sandbox", { headers: { "x-forge-token": token } });
		current = await res.json();
	} catch {
		box.replaceChildren(el("p", "note", "Could not read the sandbox setting."));
		return;
	}
	let mode = current.mode;
	const options = el("div", "sandbox-options");
	const folder = Object.assign(el("input"), { value: current.folder, spellcheck: false, placeholder: "Full path of the workspace folder" });
	const folderRow = el("label", "field");
	folderRow.append(el("span", "field-label", "Workspace folder"), folder, el("span", "field-hint", "The agent's files stay in here. Default: the folder the harness was started in."));
	const draw = () => {
		options.replaceChildren(
			...SANDBOX_MODES.map(([value, label, help]) => {
				const row = el("label", `sandbox-option${value === mode ? " on" : ""}`);
				const radio = Object.assign(el("input"), { type: "radio", name: "sandbox", checked: value === mode });
				radio.onchange = () => {
					mode = value;
					draw();
				};
				const text = el("span", "q-text");
				text.append(el("b", "", label), el("span", "", help));
				row.append(radio, text);
				return row;
			}),
		);
		folderRow.hidden = mode === "off";
	};
	draw();
	const note = el(
		"p",
		"note",
		"This is a policy inside the harness, not an operating-system sandbox: the harness's own custom tools and MCP servers run normally. For full isolation, run it in a container.",
	);
	const save = button("Save", "btn primary small", async () => {
		if (busy) return toast("Wait for the agent to finish, then save.", "warning");
		const res = await fetch("/api/sandbox", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forge-token": token },
			body: JSON.stringify({ mode, folder: mode === "off" ? "" : folder.value.trim(), sessionPath: currentSession }),
		});
		if (!res.ok) return toast(`Could not save: ${await res.text()}`, "error");
		toast(`Sandbox: ${SANDBOX_MODES.find((m) => m[0] === mode)?.[1]}. Restarting the agent…`);
		renderSafety(box);
	});
	const actions = el("div", "card-actions");
	actions.append(save);
	box.replaceChildren(options, folderRow, note, actions);
}

// ---------------------------------------------------------------------------
// MCP servers (Settings)
// ---------------------------------------------------------------------------

async function mcpRequest(path, body) {
	const res = await fetch(path, {
		method: body ? "POST" : "GET",
		headers: { "content-type": "application/json", "x-forge-token": token },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

async function renderMcp(box, editing) {
	let data;
	try {
		data = await mcpRequest("/api/mcp");
	} catch (error) {
		box.replaceChildren(el("p", "note", `Could not read MCP servers: ${error.message}`));
		return;
	}
	box.replaceChildren();
	const grid = el("div", "provider-grid");
	for (const sv of data.servers) grid.append(editing === sv.name ? mcpForm(box, sv) : mcpCard(box, sv));
	if (editing === "") grid.append(mcpForm(box));
	box.append(grid);
	if (!data.servers.length && editing === undefined) box.append(el("p", "note", "No MCP servers yet."));

	const actions = el("div", "card-actions");
	if (editing === undefined) {
		actions.append(button("Add server", "btn primary small", () => renderMcp(box, "")));
		actions.append(button("Paste config", "btn small", () => mcpPaste(box)));
	}
	if (data.servers.length) {
		const out = el("pre", "mcp-test");
		out.hidden = true;
		const test = button("Test connections", "btn small", async () => {
			test.disabled = true;
			test.textContent = "Testing…";
			out.hidden = false;
			out.textContent = "Connecting to each enabled server…";
			try {
				const r = await mcpRequest("/api/mcp/test", {});
				out.textContent = r.output || (r.ok ? "All servers connected." : "Test failed.");
				out.classList.toggle("bad", !r.ok);
			} catch (error) {
				out.textContent = error.message;
			}
			test.disabled = false;
			test.textContent = "Test connections";
		});
		actions.append(test);
		box.append(actions, out);
	} else box.append(actions);
}

function mcpCard(box, sv) {
	const card = el("div", "card provider");
	const head = el("div", "card-head");
	head.append(el("b", "", sv.name), el("span", `badge${sv.enabled ? " ok" : ""}`, sv.enabled ? (sv.kind === "http" ? "Remote" : "Local") : "Off"));
	card.append(head);
	if (sv.description) card.append(el("p", "note", sv.description));
	const what = sv.kind === "http" ? sv.url : [sv.command, ...(sv.args ?? [])].join(" ");
	card.append(el("code", "mcp-cmd", what ?? ""));
	const meta = el("div", "meta");
	meta.append(el("span", "chip", sv.exposure === "direct" ? "tools always loaded" : sv.exposure === "deferred" ? "tools loaded on demand" : sv.exposure));
	for (const k of Object.keys(sv.env ?? {})) meta.append(el("span", "chip", k));
	for (const k of Object.keys(sv.headers ?? {})) meta.append(el("span", "chip", k));
	card.append(meta);
	const actions = el("div", "card-actions");
	actions.append(
		button("Edit", "btn small", () => renderMcp(box, sv.name)),
		button(sv.enabled ? "Turn off" : "Turn on", "btn small", () => mcpSave(box, { ...mcpUnmask(sv), enabled: !sv.enabled }, sv.name)),
		button("Remove", "btn small", async () => {
			try {
				await mcpRequest("/api/mcp", { action: "remove", name: sv.name, sessionPath: currentSession });
				toast(`${sv.name} removed. Restarting the agent…`);
				renderMcp(box);
			} catch (error) {
				toast(`Could not remove: ${error.message}`, "error");
			}
		}),
	);
	card.append(actions);
	return card;
}

/** A server as the form/API expects it (masked values are sent back unchanged and kept by the server). */
function mcpUnmask(sv) {
	return { name: sv.name, kind: sv.kind, command: sv.command, args: sv.args ?? [], cwd: sv.cwd, url: sv.url, env: sv.env, headers: sv.headers, exposure: sv.exposure, enabled: sv.enabled, description: sv.description };
}

const linesToMap = (text, sep) =>
	Object.fromEntries(
		text
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => {
				const i = l.indexOf(sep);
				return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + sep.length).trim()];
			}),
	);
const mapToLines = (map, sep) => Object.entries(map ?? {}).map(([k, v]) => `${k}${sep}${v}`).join("\n");

function mcpForm(box, sv) {
	const card = el("div", "card provider mcp-form");
	card.append(el("b", "", sv ? `Edit ${sv.name}` : "Add an MCP server"));
	const field = (label, input, hint) => {
		const l = el("label", "field");
		l.append(el("span", "field-label", label), input);
		if (hint) l.append(el("span", "field-hint", hint));
		return l;
	};
	const input = (value = "", placeholder = "") => Object.assign(el("input"), { value, placeholder, spellcheck: false, autocomplete: "off" });
	const area = (value = "", placeholder = "") => Object.assign(el("textarea"), { value, placeholder, rows: 3, spellcheck: false });

	const name = input(sv?.name, "github");
	let kind = sv?.kind ?? "stdio";
	const seg = el("div", "seg");
	const local = el("div", "mcp-kind");
	const remote = el("div", "mcp-kind");
	for (const [value, label] of [
		["stdio", "Local program"],
		["http", "Remote URL"],
	]) {
		const b = button(label, value === kind ? "on" : "", () => {
			kind = value;
			for (const other of seg.children) other.classList.toggle("on", other === b);
			local.hidden = kind !== "stdio";
			remote.hidden = kind !== "http";
		});
		seg.append(b);
	}
	const command = input(sv?.command, "npx");
	const args = area((sv?.args ?? []).join("\n"), "-y\n@modelcontextprotocol/server-github");
	const env = area(mapToLines(sv?.env, "="), "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…");
	local.append(
		field("Command", command, "One program, e.g. npx, uvx, node, or a full path"),
		field("Arguments", args, "One per line"),
		field("Environment variables", env, "NAME=value, one per line. Values are stored on this computer and masked here."),
	);
	const url = input(sv?.url, "https://example.com/mcp");
	const headers = area(mapToLines(sv?.headers, ": "), "Authorization: Bearer …");
	remote.append(field("URL", url, "Streamable HTTP endpoint (often ends in /mcp)"), field("Headers", headers, "Name: value, one per line. Leave empty for servers that sign in with OAuth."));
	local.hidden = kind !== "stdio";
	remote.hidden = kind !== "http";

	const description = input(sv?.description, "What it gives the agent, in a sentence");
	const deferred = Object.assign(el("input"), { type: "checkbox", checked: sv?.exposure === "deferred" });
	const deferredRow = el("label", "check-row");
	deferredRow.append(deferred, el("span", "", "Load its tools on demand (for servers with many tools)"));

	card.append(field("Name", name, "Letters, digits, - and _"), seg, local, remote, field("Description", description), deferredRow);
	const actions = el("div", "card-actions");
	actions.append(
		button("Save", "btn primary small", () =>
			mcpSave(
				box,
				{
					name: name.value.trim(),
					kind,
					command: command.value.trim(),
					args: args.value.split("\n").map((a) => a.trim()).filter(Boolean),
					env: linesToMap(env.value, "="),
					url: url.value.trim(),
					headers: linesToMap(headers.value, ":"),
					description: description.value.trim(),
					exposure: deferred.checked ? "deferred" : sv?.exposure && sv.exposure !== "deferred" ? sv.exposure : "direct",
					enabled: sv?.enabled ?? true,
				},
				sv?.name,
			),
		),
		button("Cancel", "btn small", () => renderMcp(box)),
	);
	card.append(actions);
	setTimeout(() => name.focus(), 0);
	return card;
}

async function mcpSave(box, server, previousName) {
	if (busy) return toast("Wait for the agent to finish, then save.", "warning");
	try {
		await mcpRequest("/api/mcp", { action: "save", server, previousName, sessionPath: currentSession });
		toast(`${server.name} saved. Restarting the agent…`);
		renderMcp(box);
	} catch (error) {
		toast(`Could not save: ${error.message}`, "error");
	}
}

/** Paste the JSON an MCP server's README gives (Claude Desktop / Cursor format, or a single entry). */
function mcpPaste(box) {
	const card = el("div", "card provider mcp-form");
	const text = Object.assign(el("textarea"), { rows: 8, spellcheck: false, placeholder: '{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] } } }' });
	const single = Object.assign(el("input"), { placeholder: "Name, if the JSON is a single server (e.g. github)", spellcheck: false });
	card.append(el("b", "", "Paste an MCP config"), el("p", "note", "The JSON from a server's README (the mcpServers block used by Claude Desktop, Cursor and others)."), text, single);
	const actions = el("div", "card-actions");
	actions.append(
		button("Add", "btn primary small", async () => {
			let parsed;
			try {
				parsed = JSON.parse(text.value);
			} catch {
				return toast("That isn't valid JSON.", "error");
			}
			const entries = parsed.mcpServers ?? parsed.servers ?? (parsed.command || parsed.url ? { [single.value.trim()]: parsed } : parsed);
			let added = 0;
			for (const [name, raw] of Object.entries(entries ?? {})) {
				if (!raw || typeof raw !== "object") continue;
				const server = { name, kind: raw.url ? "http" : "stdio", command: raw.command, args: raw.args ?? [], cwd: raw.cwd, env: raw.env, url: raw.url, headers: raw.headers, description: raw.description, exposure: raw.exposure ?? "direct", enabled: raw.enabled !== false };
				try {
					await mcpRequest("/api/mcp", { action: "save", server, sessionPath: currentSession });
					added++;
				} catch (error) {
					toast(`${name}: ${error.message}`, "error");
				}
			}
			if (added) toast(`Added ${added} server${added === 1 ? "" : "s"}. Restarting the agent…`);
			renderMcp(box);
		}),
		button("Cancel", "btn small", () => renderMcp(box)),
	);
	card.append(actions);
	box.replaceChildren(card);
	text.focus();
}

function providerCard(p, modelCount, scope = "providers") {
	const card = el("div", "card provider");
	const head = el("div", "card-head");
	head.append(el("b", "", p.label));
	const saved = p.fields.some((f) => f.source === "saved");
	const fromEnv = p.fields.some((f) => f.source === "environment");
	let badge;
	if (scope === "harness") {
		const required = p.fields.some((f) => !f.optional);
		if (p.configured) badge = el("span", "badge ok", fromEnv && !saved ? "Set · from environment" : "Set");
		else badge = el("span", `badge${required ? " warn" : ""}`, required ? "Needed" : "Optional");
	} else {
		let badgeText = "Not set";
		if (modelCount > 0) badgeText = `Key set · ${modelCount} models`;
		else if (saved) badgeText = "Saved · no models found";
		else if (fromEnv) badgeText = "From environment";
		badge = el("span", `badge${modelCount > 0 ? " ok" : ""}`, badgeText);
	}
	head.append(badge);
	card.append(head);
	if (p.note) card.append(el("p", "note", p.note));
	if (p.tools?.length || p.url) {
		const meta = el("div", "meta");
		for (const t of p.tools ?? []) meta.append(el("span", "chip", t));
		if (p.url) {
			const link = el("a", "key-link", "Get a key");
			link.href = p.url;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.insertAdjacentHTML("beforeend", icon("external-link"));
			meta.append(link);
		}
		card.append(meta);
	}

	const form = el("div", "fields");
	const inputs = new Map();
	for (const f of p.fields) {
		const label = el("label", "field");
		const name = el("span", "field-label", f.label);
		if (f.source) name.append(el("span", "field-source", f.source === "saved" ? "saved" : "from environment"));
		const input = el("input");
		input.type = f.secret ? "password" : "text";
		input.autocomplete = "off";
		input.spellcheck = false;
		input.placeholder = f.preview || f.placeholder || "";
		if (!f.secret && f.source === "saved") input.value = f.preview;
		inputs.set(f.env, input);
		label.append(name, input);
		form.append(label);
	}
	card.append(form);

	const actions = el("div", "card-actions");
	const save = button("Save", "btn primary small", async () => {
		const values = {};
		for (const [env, input] of inputs) {
			const field = p.fields.find((f) => f.env === env);
			const v = input.value.trim();
			if (v && !(field && !field.secret && v === field.preview && field.source === "saved")) values[env] = v;
		}
		if (Object.keys(values).length === 0) return toast("Enter a value to save.", "warning");
		await saveCredentials(p, values, scope);
	});
	actions.append(save);
	if (saved) {
		actions.append(
			button("Remove saved", "btn small", async () => {
				const values = {};
				for (const f of p.fields) if (f.source === "saved") values[f.env] = null;
				await saveCredentials(p, values, scope);
			}),
		);
	}
	card.append(actions);
	return card;
}

async function saveCredentials(p, values, scope = "providers") {
	if (busy) return toast("Wait for the agent to finish, then save.", "warning");
	const res = await fetch("/api/credentials", {
		method: "POST",
		headers: { "content-type": "application/json", "x-forge-token": token },
		body: JSON.stringify({ scope, id: p.id, values, sessionPath: currentSession }),
	});
	if (!res.ok) return toast(`Could not save: ${await res.text()}`, "error");
	toast(`${p.label} saved. Restarting the agent…`);
	// The forge_agent_restarted event reloads the chat and this page.
}

async function renderPage(which) {
	const page = $("#page");
	if (which === "settings") return renderSettings(page);
	if (which === "schedules") return renderSchedules(page);
	if (which === "views") {
		page.replaceChildren(
			pageHead(
				config.isForge ? "View catalog" : "Views",
				config.isForge ? "Every view forge can give a harness, drawn with its sample data." : `How ${config.title} shows results, drawn with sample data.`,
			),
		);
		const grid = el("div", "grid");
		page.append(grid);
		for (const v of config.preview) {
			const card = el("div", "card");
			const head = el("div", "card-head");
			head.append(iconSpan("c-icon", "views"), el("b", "", v.title ?? v.id));
			if (config.isForge) head.append(el("span", "badge", v.inHarness ? "used by forge" : "template"));
			const sample = el("div", "view-sample");
			card.append(head, el("p", "", v.description ?? ""));
			if (v.domains?.length) {
				const meta = el("div", "meta");
				for (const d of v.domains) meta.append(el("span", "chip", d === "*" ? "any domain" : d));
				card.append(meta);
			}
			card.append(sample);
			grid.append(card);
			fetch(`/views/${v.id}/sample.json`)
				.then((r) => r.json())
				.then((data) => renderView(sample, v.id, data));
		}
		return;
	}

	if (which === "tools") {
		page.replaceChildren(pageHead("Tools", `What ${config.title}'s agent can do. Type + in the message box for skills and commands.`));
		const grid = el("div", "grid");
		const groups = [
			["Domain tools", config.tools.custom, "tool"],
			["Built-in tools", config.tools.builtin, "terminal"],
			["Planning", config.tools.plan ? ["update_plan"] : [], "planning"],
		];
		const commands = await call({ type: "get_commands" });
		const skills = (commands.success ? (commands.data.commands ?? []) : []).filter((c) => c.source === "skill");
		for (const [title, names, iconName] of groups) {
			if (!names.length) continue;
			const card = el("div", "card");
			const head = el("div", "card-head");
			head.append(iconSpan("c-icon", iconName), el("b", "", title), el("span", "badge", String(names.length)));
			const meta = el("div", "meta");
			for (const n of names) meta.append(el("span", "chip", n));
			card.append(head, meta);
			grid.append(card);
		}
		if (skills.length > 0) {
			const card = el("div", "card wide");
			const head = el("div", "card-head");
			head.append(iconSpan("c-icon", "knowledge-base"), el("b", "", "Skills"), el("span", "badge", String(skills.length)));
			card.append(head, el("p", "", "Know-how the agent loads when a task needs it. Click one to use it now."));
			const list = el("div", "skill-list");
			for (const sk of skills) {
				const name = sk.name.replace(/^skill:/, "");
				const row = el("button", "skill-row");
				row.type = "button";
				row.append(el("b", "", name), el("span", "", sk.description ?? ""));
				row.onclick = () => {
					setMode("chat");
					$("#input").value = `/${sk.name} `;
					autosize();
					$("#input").focus();
				};
				list.append(row);
			}
			card.append(list);
			grid.append(card);
		}
		page.append(grid);
		return;
	}

	// Harnesses (forge only)
	page.replaceChildren(pageHead("Harnesses", "Every harness in this workspace. Run one, or ask forge to change it."));
	const grid = el("div", "grid");
	page.append(grid);
	const res = await fetch("/api/harnesses", { headers: { "x-forge-token": token } });
	const list = res.ok ? await res.json() : [];
	if (list.length === 0) grid.append(el("p", "", "No harnesses yet. Describe one in the message box to build it."));
	for (const h of list) {
		const card = el("div", "card");
		const head = el("div", "card-head");
		head.append(iconSpan("c-icon", h.name === "forge" ? "agent" : "layers"), el("b", "", h.title), el("span", "badge", h.name));
		const meta = el("div", "meta");
		meta.append(el("span", "chip", h.model.replace(/^global\.anthropic\./, "")));
		meta.append(el("span", "chip", `${h.tools} tool${h.tools === 1 ? "" : "s"}`));
		if (h.skills) meta.append(el("span", "chip", `${h.skills} skill${h.skills === 1 ? "" : "s"}`));
		if (h.keys?.length) meta.append(el("span", "chip", `keys: ${h.keys.join(", ")}`));
		for (const v of h.views) meta.append(el("span", "chip", v));
		const bin = h.name === "forge" ? "forge/bin/forge.ts" : `${h.path}/bin/${h.name}.ts`;
		const actions = el("div", "card-actions");
		if (h.name !== "forge") {
			const update = el("button", "btn small", "Update with forge");
			update.type = "button";
			update.insertAdjacentHTML("afterbegin", icon("edit"));
			update.onclick = () => {
				setMode("chat");
				$("#input").value = `Update the ${h.name} harness: `;
				autosize();
				$("#input").focus();
			};
			actions.append(update);
		}
		card.append(head, el("p", "", h.description || "No description."), meta, cmd(`node ${bin} web`), cmd(`node ${bin}`), actions);
		grid.append(card);
	}
}

// ---------------------------------------------------------------------------
// Chats sidebar
// ---------------------------------------------------------------------------

let sessions = [];
let currentSession = "";

function ago(ms) {
	const s = (Date.now() - ms) / 1000;
	if (s < 60) return "now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
	return new Date(ms).toLocaleDateString();
}

let sessionsLoaded = false;

async function loadSessions() {
	const res = await fetch(`/api/sessions${AGENT_QUERY}`, { headers: { "x-forge-token": token } });
	if (res.ok) sessions = await res.json();
	sessionsLoaded = true;
	renderSessions();
}

/** Grey placeholder rows while something loads. */
function skeletonRows(count, cls) {
	return Array.from({ length: count }, (_, i) => {
		const row = el("div", `skeleton ${cls}`);
		row.style.setProperty("--w", `${[78, 62, 86, 54, 70, 66][i % 6]}%`);
		return row;
	});
}

/** The chat area while a chat loads (page load, reconnect, switching chats). Replaced by the transcript. */
function showChatSkeleton() {
	const box = el("div", "chat-skeleton");
	box.setAttribute("aria-label", "Loading chat");
	const user = el("div", "skeleton sk-bubble");
	box.append(user, ...skeletonRows(4, "sk-line"));
	chat.replaceChildren(box);
}

function renderSessions() {
	const query = $("#search").value.trim().toLowerCase();
	const list = $("#sessions");
	const shown = sessions.filter((s) => !query || s.title.toLowerCase().includes(query));
	list.replaceChildren();
	if (!sessionsLoaded) {
		list.append(...skeletonRows(5, "sk-session"));
		return;
	}
	if (shown.length === 0) list.append(el("div", "empty-note", query ? "No matching chats" : "No saved chats yet"));
	for (const s of shown) {
		const b = el("button", `session${s.path === currentSession ? " current" : ""}`);
		b.type = "button";
		b.title = s.title;
		b.insertAdjacentHTML("beforeend", icon("chat"));
		b.append(el("span", "label", s.title || "Untitled"), el("span", "when", ago(s.modified)));
		b.onclick = () => openSession(s.path);
		list.append(b);
	}
}

async function openSession(path) {
	app.classList.remove("sidebar-open");
	setMode("chat");
	if (path === currentSession) return;
	showChatSkeleton();
	const res = await call({ type: "switch_session", sessionPath: path });
	if (!res.success) toast(`Could not open chat: ${res.error}`, "error");
	else if (res.data?.cancelled) toast("Switching chats was cancelled by the harness.", "warning");
	else await reloadChat();
}

$("#search").oninput = renderSessions;
$("#new").onclick = async () => {
	app.classList.remove("sidebar-open");
	setMode("chat");
	const res = await call({ type: "new_session" });
	if (res.success) await reloadChat();
};

// ---------------------------------------------------------------------------
// Transcript: turns (your message, then the agent's work: steps, outputs, answer)
// ---------------------------------------------------------------------------

let busy = false;
let noProvider = false; // no model provider is set up yet (no key, no AWS credentials)
let missingKeys = []; // this harness's services with required keys not set
let replaying = true;
let follow = true;
let turn = null; // the current turn
let lastTimestamp = 0;
const steps = new Map(); // toolCallId -> { row, turn, name, args }

const atBottom = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 140;
scroller.addEventListener("scroll", () => {
	follow = atBottom();
});
function keepAtBottom() {
	if (follow && mode === "chat") scroller.scrollTop = scroller.scrollHeight;
}

function clearChat() {
	chat.replaceChildren();
	steps.clear();
	turn = null;
	lastTimestamp = 0;
	outputs.clear();
	renderOutputs();
	showPlan(null);
	for (const [id, v] of panelViews) $(`#panel-${id} .body`).replaceChildren(panelPlaceholder(v));
}

function actionCard(iconName, title, sub, onclick) {
	const card = el("button", "action");
	card.type = "button";
	const text = el("span", "a-text");
	text.append(el("b", "", title), el("span", "a-sub", sub));
	card.append(iconSpan("a-icon", iconName), text, iconSpan("a-go", "arrow-right"));
	card.onclick = onclick;
	return card;
}

function useSuggestion(text) {
	$("#input").value = text;
	autosize();
	$("#input").focus();
}

function showWelcome() {
	if (chat.querySelector(".turn, .msg")) return;
	chat.replaceChildren();
	const box = el("div", "welcome");
	const mark = el("div", "welcome-mark");
	if (config.brand?.mark) mark.append(brandShape("mark", "", 64));
	else mark.append(aiState("idle", 56));
	box.append(mark);
	if (BUILD) {
		box.append(el("div", "eyebrow", config.builder.title));
		box.append(el("h1", "", `What should ${config.title} do next?`));
		box.append(
			el(
				"p",
				"sub",
				`Describe what you need. pi-Forge builds it into ${config.title} (a tool, a view, a data source or a skill), tests it, and reloads ${config.title} with it.`,
			),
		);
	} else {
		if (config.web?.eyebrow) box.append(el("div", "eyebrow", config.web.eyebrow));
		box.append(el("h1", "", config.web?.headline ?? config.title));
		const sub = config.web?.subtitle ?? config.description;
		if (sub) box.append(el("p", "sub", sub));
	}

	const actions = el("div", "actions");
	if (noProvider) {
		const setup = actionCard("settings", "Set up a model provider", "Add an Anthropic, OpenAI or AWS Bedrock key to start", () => setMode("settings"));
		setup.classList.add("setup");
		actions.append(setup);
	}
	if (missingKeys.length > 0 && !BUILD) {
		const names = missingKeys.map((g) => g.label);
		const tools = [...new Set(missingKeys.flatMap((g) => g.tools ?? []))];
		const keys = actionCard(
			"api-key",
			names.length === 1 ? `Add your ${names[0]} key` : `Add keys for ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`,
			tools.length ? `Needed by ${tools.slice(0, 4).join(", ")}${tools.length > 4 ? "…" : ""}` : "Some tools need it to work",
			() => {
				pendingSettingsFocus = "keys";
				setMode("settings");
			},
		);
		keys.classList.add("setup");
		actions.append(keys);
	}
	if (BUILD) {
		actions.append(
			actionCard("tool", "Add a tool", "A new capability: an API lookup, a calculator, an exporter…", () => useSuggestion(`Add a tool to ${config.title} that `)),
			actionCard("views", "Add a view", "A new way to see results: a chart, a map, a 3D preview…", () => useSuggestion(`Add a view to ${config.title} that shows `)),
			actionCard("api-key", "Connect a service", "Data from an API or account, with its key in Settings", () => useSuggestion(`Connect ${config.title} to `)),
			actionCard("skill", "Teach it a workflow", "A checklist, standard or procedure it should follow", () => useSuggestion(`Teach ${config.title} how to `)),
		);
	} else if (config.isForge) {
		actions.append(
			actionCard("layers", "Browse harnesses", "Open your existing harnesses", () => setMode("harnesses")),
			actionCard("views", "Explore views", "See available workspace views", () => setMode("views")),
		);
	} else {
		const hint = config.hint
			.replace(/^Try:\s*/i, "")
			.split("·")
			.map((x) => x.trim())
			.find((x) => x && !x.includes("<"));
		if (hint) actions.append(actionCard("chat", "Try an example", hint, () => useSuggestion(hint)));
		actions.append(actionCard("views", "Explore views", `How ${config.title} shows results`, () => setMode("views")));
	}
	box.append(actions);
	if (config.web?.tagline && !BUILD) box.append(el("div", "tagline", config.web.tagline));
	chat.append(box);
	updateSide();
}

/** The welcome screen goes away when anything is added; the side card may show again. */
function removeWelcome() {
	const welcome = chat.querySelector(".welcome");
	if (!welcome) return;
	welcome.remove();
	updateSide();
}

function append(node) {
	removeWelcome();
	const indicator = chat.querySelector(".working");
	if (indicator) chat.insertBefore(node, indicator);
	else chat.append(node);
	keepAtBottom();
}

function formatDuration(ms) {
	const s = Math.max(1, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "Mon, Oct 4 at 11:31 AM" before the first message and after a 30-minute gap. */
function maybeDateSeparator(ts) {
	if (!ts) return;
	if (lastTimestamp && ts - lastTimestamp < 30 * 60 * 1000) return;
	const d = new Date(ts);
	const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
	const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	append(el("div", "date-sep", `${day} at ${time}`));
}

function newTurn(userText, ts) {
	maybeDateSeparator(ts);
	if (ts) lastTimestamp = ts;
	if (userText !== undefined) {
		const m = el("div", "msg user");
		m.append(el("div", "bubble", userText));
		append(m);
	}
	const node = el("div", "turn");
	const worked = el("details", "worked");
	worked.hidden = true;
	const summary = el("summary");
	const stateHost = el("span", "worked-icon");
	const label = el("span", "worked-label", "Working");
	const chevron = Object.assign(el("span", "worked-chevron"), { innerHTML: icon("chevron-right") });
	summary.append(stateHost, label, chevron);
	const list = el("div", "steps");
	worked.append(summary, list);
	const outputsEl = el("div", "turn-outputs");
	const answer = el("div", "turn-answer");
	node.append(worked, outputsEl, answer);
	append(node);
	const usageEl = el("div", "turn-usage");
	usageEl.hidden = true;
	node.append(usageEl);
	turn = { node, worked, stateHost, label, list, outputs: outputsEl, answer, usageEl, usage: emptyUsage(), start: ts ?? Date.now(), end: 0, count: 0, files: new Map(), filesCard: null, current: null, running: true };
	return turn;
}

// A run that starts without a new user message (a follow-up) gets its own turn on its first step or text.
let needNewTurn = false;
function ensureTurn() {
	if (!turn || needNewTurn) {
		needNewTurn = false;
		return newTurn(undefined, Date.now());
	}
	return turn;
}

/** Header of the steps group: live while running, "Worked for 12s · 6 steps" when finished. */
// ---------------------------------------------------------------------------
// Usage: tokens and estimated cost per answer, per chat, and in Settings
// ---------------------------------------------------------------------------

function emptyUsage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, replies: 0 };
}

/** Adds one assistant message's usage (pi reports tokens and cost on every reply). */
function addUsage(t, usage) {
	if (!t || !usage) return;
	const u = t.usage;
	u.input += usage.input ?? 0;
	u.output += usage.output ?? 0;
	u.cacheRead += usage.cacheRead ?? 0;
	u.cacheWrite += usage.cacheWrite ?? 0;
	u.total += usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	u.cost += usage.cost?.total ?? 0;
	u.replies += 1;
	renderTurnUsage(t);
}

function fmtTokens(n) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
	return String(n);
}

function fmtCost(usd) {
	if (!usd) return "$0";
	if (usd < 0.01) return "<$0.01";
	return "$" + (usd < 10 ? usd.toFixed(2) : usd.toFixed(1));
}

function renderTurnUsage(t) {
	if (!t?.usageEl || !t.usage.replies) return;
	const u = t.usage;
	t.usageEl.hidden = false;
	t.usageEl.textContent = `${fmtTokens(u.total)} tokens · ${fmtCost(u.cost)}`;
	t.usageEl.title =
		`Input ${fmtTokens(u.input)} · cached ${fmtTokens(u.cacheRead)} · cache write ${fmtTokens(u.cacheWrite)} · output ${fmtTokens(u.output)}\n` +
		`Estimated cost ${u.cost.toFixed(4)} USD over ${u.replies} model call${u.replies === 1 ? "" : "s"}, at the model's list price`;
}

/** The open chat's totals in the top bar, from pi's session stats. */
async function refreshChatUsage() {
	const chip = $("#chat-usage");
	const stats = await call({ type: "get_session_stats" });
	const d = stats.success ? stats.data : null;
	if (!d || !d.tokens?.total) {
		chip.hidden = true;
		return;
	}
	chip.hidden = false;
	chip.textContent = fmtCost(d.cost);
	const ctx = d.contextUsage?.contextWindow ? ` · context ${Math.round(d.contextUsage.percent ?? 0)}% of ${fmtTokens(d.contextUsage.contextWindow)}` : "";
	chip.title = `This chat: ${fmtTokens(d.tokens.total)} tokens, about ${(d.cost ?? 0).toFixed(3)} USD${ctx}`;
}

function updateWorkedLabel(t = turn) {
	if (!t || t.count === 0) return;
	const stepsText = `${t.count} step${t.count === 1 ? "" : "s"}`;
	if (t.running) {
		const current = plan?.steps.find((s) => s.status === "in_progress")?.step;
		t.label.textContent = `${current ? current : agentLabel} · ${stepsText}`;
		let live = t.stateHost.querySelector("ai-state");
		if (!live) {
			t.stateHost.replaceChildren(aiState(agentState, 18));
			live = t.stateHost.querySelector("ai-state");
		}
		live.state = agentState === "idle" || agentState === "done" ? "thinking" : agentState;
	} else {
		t.label.textContent = `Worked for ${formatDuration(t.end - t.start)} · ${stepsText}`;
		t.stateHost.innerHTML = icon("timer");
	}
}

function closeTurn(t, endTs) {
	if (!t) return;
	renderTurnUsage(t);
	t.running = false;
	t.end = endTs || Date.now();
	if (t.count > 0) {
		t.worked.open = false;
		updateWorkedLabel(t);
	}
	if (t.current) t.current = null;
}

function addAnswerText(t, text) {
	if (!text.trim()) return;
	const block = el("div", "text");
	t.answer.append(block);
	renderMarkdown(block, text);
	keepAtBottom();
}

function addNotice(t, message, kind = "error") {
	const n = el("div", `notice ${kind}`);
	n.append(Object.assign(el("span", "row-icon"), { innerHTML: icon("alert-circle") }), el("span", "", message));
	t.answer.append(n);
	keepAtBottom();
}

/** One readable line of arguments; the full input is in the step's details. */
function argsSummary(args) {
	if (!args || typeof args !== "object") return "";
	return Object.entries(args)
		.map(([k, v]) => {
			const value = typeof v === "string" ? v : JSON.stringify(v);
			return `${k}: ${value.length > 80 ? `${value.slice(0, 80)}…` : value}`;
		})
		.join("  ·  ");
}

function stepLabel(name, args) {
	if (name === "update_plan") return "Updated the plan";
	const change = fileChange(name, args);
	if (change) return `${name === "write" ? "Wrote" : "Edited"} ${splitPath(change.path).base}`;
	return argsSummary(args);
}

function addStep(id, name, args, live = true) {
	const t = ensureTurn();
	let entry = steps.get(id);
	if (entry) return entry;
	const row = el("div", "step running");
	const head = el("div", "step-head");
	const iconHost = el("span", "step-icon");
	iconHost.append(aiState(toolState(name), 16, { live }));
	head.append(iconHost, el("span", "step-name", name), el("span", "step-args", stepLabel(name, args)), el("span", "step-state", ""));
	const body = el("div", "step-body");
	if (args && Object.keys(args).length > 0) {
		const input = el("details", "step-input");
		input.append(el("summary", "", "input"), el("pre", "", JSON.stringify(args, null, 2)));
		body.append(input);
	}
	head.onclick = () => row.classList.toggle("open");
	row.append(head, body);
	t.list.append(row);
	t.count++;
	t.worked.hidden = false;
	if (t.running) t.worked.open = true;
	entry = { row, turn: t, name, args };
	steps.set(id, entry);
	updateWorkedLabel(t);
	keepAtBottom();
	return entry;
}

function finishStep(id, name, result, isError) {
	const entry = steps.get(id) ?? addStep(id, name, undefined, false);
	const { row, turn: t, args } = entry;
	row.classList.remove("running");
	row.classList.add(isError ? "error" : "ok");
	const state = row.querySelector(".step-icon ai-state");
	if (state) {
		state.state = isError ? "error" : "done";
		setTimeout(() => state.setAttribute("live", "false"), 1200);
	}
	row.querySelector(".step-state").textContent = isError ? "failed" : "";
	const details = result?.details;
	const body = row.querySelector(".step-body");

	if (!isError && name === "update_plan" && details?.data) {
		showPlan(details.data);
		return;
	}
	if (!isError && details && typeof details.view === "string" && "data" in details) {
		// View results are the outputs the user came for: shown in the turn, not hidden in the steps.
		const card = el("div", "output-card");
		const head = el("div", "output-head");
		head.append(Object.assign(el("span", "row-icon"), { innerHTML: icon("tool") }), el("span", "output-name", name), el("span", "output-args", argsSummary(args)));
		const host = el("div", "view-host");
		card.append(head, host);
		t.outputs.append(card);
		renderView(host, details.view, details.data);
		if (panelViews.has(details.view)) renderView($(`#panel-${details.view} .body`), details.view, details.data);
		row.querySelector(".step-state").textContent = "shown below";
		return;
	}
	const text = textOf(result?.content);
	body.append(el("pre", "out", text.length > 8000 ? `${text.slice(0, 8000)}\n…` : text || "(no output)"));
	if (isError) row.classList.add("open");

	const change = !isError ? fileChange(name, args) : undefined;
	if (change) {
		const prev = t.files.get(change.path) ?? { added: 0, removed: 0 };
		t.files.set(change.path, { added: prev.added + change.added, removed: prev.removed + change.removed });
		const all = outputs.get(change.path) ?? { added: 0, removed: 0 };
		outputs.delete(change.path);
		outputs.set(change.path, { added: all.added + change.added, removed: all.removed + change.removed });
		renderFilesCard(t);
		renderOutputs();
	}
}

/** "Edited 12 files +869 -0" card, first three files, then "Show N more files". */
function renderFilesCard(t) {
	if (!t.filesCard) {
		t.filesCard = el("div", "files-card");
		t.outputs.append(t.filesCard);
	}
	const files = [...t.files];
	const added = files.reduce((n, [, c]) => n + c.added, 0);
	const removed = files.reduce((n, [, c]) => n + c.removed, 0);
	const head = el("div", "files-head");
	const title = el("div", "files-title");
	title.append(el("b", "", `Edited ${files.length} file${files.length === 1 ? "" : "s"}`), stat(added, removed));
	head.append(Object.assign(el("span", "files-icon"), { innerHTML: icon("file-edit") }), title);
	const list = el("div", "files-list");
	const expanded = t.filesCard.classList.contains("expanded");
	for (const [i, [path, change]] of files.entries()) {
		const row = fileRow(path, change, true);
		if (i >= 3 && !expanded) row.hidden = true;
		list.append(row);
	}
	const parts = [head, list];
	if (files.length > 3) {
		const more = el("button", "files-more", expanded ? "Show fewer files" : `Show ${files.length - 3} more files`);
		more.type = "button";
		more.insertAdjacentHTML("beforeend", icon(expanded ? "chevron-up" : "chevron-down"));
		more.onclick = () => {
			t.filesCard.classList.toggle("expanded");
			renderFilesCard(t);
		};
		parts.push(more);
	}
	t.filesCard.replaceChildren(...parts);
	keepAtBottom();
}

/** Rebuild the transcript from pi's message list (on load and after switching chats). */
function renderMessages(messages) {
	clearChat();
	for (const m of messages) {
		if (m.role === "user") {
			closeTurn(turn, lastTimestamp);
			newTurn(textOf(m.content), m.timestamp);
		} else if (m.role === "assistant") {
			addUsage(ensureTurn(), m.usage);
			const t = ensureTurn();
			for (const part of Array.isArray(m.content) ? m.content : []) {
				if (part.type === "text") addAnswerText(t, part.text);
				else if (part.type === "toolCall") addStep(part.id, part.name, part.arguments, false);
			}
			if (m.stopReason === "error" && m.errorMessage) addNotice(t, m.errorMessage);
		} else if (m.role === "toolResult") finishStep(m.toolCallId, m.toolName, m, m.isError);
		// System prompt and other hidden messages do not count as conversation time.
		if (m.timestamp && (m.role === "user" || m.role === "assistant" || m.role === "toolResult")) lastTimestamp = m.timestamp;
	}
	if (!busy) closeTurn(turn, lastTimestamp);
	refreshChatUsage();
	const firstUser = messages.find((m) => m.role === "user");
	return firstUser ? textOf(firstUser.content).replace(/\s+/g, " ").trim() : "";
}

async function reloadChat() {
	const [state, history, models] = await Promise.all([
		call({ type: "get_state" }),
		call({ type: "get_messages" }),
		call({ type: "get_available_models" }),
	]);
	if (models.success) noProvider = (models.data.models ?? []).length === 0;
	try {
		const res = await fetch("/api/credentials", { headers: { "x-forge-token": token } });
		missingKeys = res.ok ? ((await res.json()).harness ?? []).filter((g) => !g.configured && g.fields.some((f) => !f.optional)) : [];
	} catch {
		missingKeys = [];
	}
	if (state.success) applyState(state.data);
	const first = history.success ? renderMessages(history.data.messages ?? []) : "";
	chatTitle = state.data?.sessionName || (first ? first.slice(0, 80) : "New chat");
	if (mode === "chat") setCrumb(chatTitle);
	showWelcome();
	follow = true;
	keepAtBottom();
	updateWorking();
	loadSessions();
}

function applyState(data) {
	const wasBusy = busy;
	const m = data?.model;
	$("#model-name").textContent = noProvider ? "Set up a model" : m ? (m.name ?? m.id).replace(/\s*\((Global|US|EU)\)\s*$/, "") : "No model";
	$("#model-level").textContent = data?.thinkingLevel ?? "off";
	currentSession = data?.sessionFile ?? "";
	if (data?.isStreaming && !wasBusy) {
		if (agentLabel === "Idle") {
			agentState = "thinking";
			agentLabel = "Working";
		}
		setAgentState(agentState, agentLabel);
	}
	setBusy(!!data?.isStreaming);
}

// ---------------------------------------------------------------------------
// Agent state (morphing icon in the top bar, the steps header, and the working line)
// ---------------------------------------------------------------------------

let agentState = "idle";
const runningTools = new Map(); // toolCallId -> tool name
let agentLabel = "Idle";
let settleTimer = null;

/** Lookups read as "searching"; anything else a tool does reads as "working". */
function toolState(toolName) {
	if (toolName === "update_plan") return "thinking";
	return /search|lookup|find|grep|list|similar|fetch|query|read|inspect|get_/i.test(toolName) ? "searching" : "working";
}

function setAgentState(state, label) {
	clearTimeout(settleTimer);
	agentState = state;
	agentLabel = label;
	const top = $("#agent-state");
	top.state = state;
	top.title = label;
	const line = chat.querySelector(".working");
	if (line) {
		line.querySelector("ai-state").state = state;
		line.querySelector(".working-label").textContent = label;
	}
	if (turn?.running) updateWorkedLabel(turn);
}

/** After a run: show done (or keep error/stopped) briefly, then rest at idle. */
function settleAgentState() {
	if (agentState !== "error" && agentState !== "paused") setAgentState("done", "Done");
	settleTimer = setTimeout(() => {
		if (!busy) setAgentState("idle", "Idle");
	}, 2500);
}

// Status line: at the bottom of the chat the whole time the agent works. It says what is happening now
// (thinking, writing a file, running a tool, writing the reply), for how long, and a live line of the reasoning.
let runStartedAt = 0;
let phaseStartedAt = 0;
let workingDetail = "";
let thinkingTail = "";
let statusTicker = null;
let queued = []; // messages sent while the agent works, not yet read by it

function fmtElapsed(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function updateWorking() {
	let line = chat.querySelector(".working");
	if (!busy) {
		line?.remove();
		chat.querySelector(".queued-list")?.remove();
		clearInterval(statusTicker);
		statusTicker = null;
		return;
	}
	if (!line) {
		removeWelcome();
		line = el("div", "working");
		const main = el("div", "working-main");
		const top = el("div", "working-top");
		top.append(el("span", "working-label"), el("span", "working-time"));
		main.append(top, el("div", "working-detail"));
		line.append(aiState(agentState, 20), main);
	}
	if (!runStartedAt) runStartedAt = phaseStartedAt = Date.now();
	statusTicker ??= setInterval(updateWorking, 1000);
	line.querySelector("ai-state").state = agentState;
	line.querySelector(".working-label").textContent = agentLabel;
	const total = Date.now() - runStartedAt;
	const phase = Date.now() - phaseStartedAt;
	line.querySelector(".working-time").textContent = ` · ${fmtElapsed(phase)}${total - phase > 2000 ? `  (${fmtElapsed(total)} in total)` : ""}`;
	const detail = line.querySelector(".working-detail");
	detail.textContent = workingDetail;
	detail.hidden = !workingDetail;
	renderQueued();
	// Queued messages, then the status line, stay last: below anything the run adds.
	const queue = chat.querySelector(".queued-list");
	if (queue && queue.nextElementSibling !== line) chat.append(queue);
	if (chat.lastElementChild !== line) {
		chat.append(line);
		keepAtBottom();
	}
}

/** Messages sent mid-run wait until the agent's current step ends; show them so they don't look lost. */
function renderQueued() {
	let box = chat.querySelector(".queued-list");
	if (queued.length === 0) {
		box?.remove();
		return;
	}
	if (!box) {
		box = el("div", "queued-list");
		chat.append(box);
	}
	const key = JSON.stringify(queued);
	if (box.dataset.key === key) return;
	box.dataset.key = key;
	box.replaceChildren(
		...queued.map((text) => {
			const row = el("div", "msg user queued");
			const inner = el("div", "queued-inner");
			inner.append(el("div", "bubble", text), el("div", "queued-note", "Queued · the agent reads it after its current step"));
			row.append(inner);
			return row;
		}),
	);
}

/** A builder run changed the harness: reload what the page knows (tools, views), and tell the user. */
async function harnessUpdated(event) {
	if (!event.ok) {
		toast(`${config.title} changed, but its spec has errors, so it wasn't reloaded: ${event.error ?? ""}`, "error");
		return;
	}
	try {
		Object.assign(config, await (await fetch("/api/config")).json());
		panelViews.clear();
		if (!BUILD) for (const v of config.views.filter((x) => x.panel)) panelViews.set(v.id, v);
	} catch {
		// the old config keeps working until the next page load
	}
	const what = `${event.tools?.length ?? 0} tools, ${event.views?.length ?? 0} views`;
	if (BUILD) {
		const t = ensureTurn();
		const note = el("div", "update-note");
		note.append(
			el("span", "", `Applied to ${config.title}: its agent reloaded with ${what}.`),
			button(`Open ${config.title}`, "btn small primary", () => {
				location.href = "/";
			}),
		);
		t.answer.append(note);
		keepAtBottom();
	} else toast(`${config.title} was updated (${what}). The new tools are ready.`);
}

/** Replay after a page load or reconnect: rebuild what the agent is doing, and since when, from the event log. */
function replayStatus(event) {
	const ts = typeof event._ts === "number" ? event._ts : Date.now();
	const phase = (state, label, detail = "") => {
		agentState = state;
		agentLabel = label;
		phaseStartedAt = ts;
		workingDetail = detail;
	};
	switch (event.type) {
		case "agent_start":
			if (!runStartedAt) runStartedAt = ts;
			phase("thinking", "Thinking");
			break;
		case "agent_settled":
			runStartedAt = 0;
			queued = [];
			runningTools.clear();
			phase("idle", "Idle");
			break;
		case "message_update": {
			const e = event.assistantMessageEvent;
			if (e?.type === "thinking_start") phase("thinking", "Thinking");
			else if (e?.type === "text_start") phase("generating", "Writing the reply");
			else if (e?.type === "toolcall_start" && e.tool) phase("working", toolPrepLabel(e.tool));
			else if (e?.type === "toolcall_delta" && e.tool && agentState === "working") {
				// The server's snapshot of the call being written: sharpen the label, keep the step's start time.
				agentLabel = toolPrepLabel(e.tool);
				workingDetail = e.tool.chars > 2000 ? `${(e.tool.chars / 1000).toFixed(1)}k characters so far` : "";
			}
			break;
		}
		case "tool_execution_start": {
			runningTools.set(event.toolCallId, event.toolName);
			const a = event.args ?? {};
			const target = [a.path, a.file_path, a.command, a.url, a.query].find((v) => typeof v === "string") ?? "";
			phase(
				toolState(event.toolName),
				event.toolName === "update_plan" ? "Updating the plan" : `Running ${event.toolName}`,
				target.replace(/\s+/g, " ").slice(0, 140),
			);
			break;
		}
		case "tool_execution_end":
			runningTools.delete(event.toolCallId);
			phase("thinking", "Thinking");
			break;
		case "queue_update":
			queued = [...(event.steering ?? []), ...(event.followUp ?? [])];
			break;
		case "auto_retry_start":
			phase("thinking", "Retrying after a provider error");
			break;
	}
}

/** A new phase of the run: label, state icon, and the phase timer restarts. */
function setPhase(state, label, detail = "") {
	if (agentLabel !== label) phaseStartedAt = Date.now();
	workingDetail = detail;
	setAgentState(state, label);
	updateWorking();
}

/** The last part of the reasoning, on one line, for the status line. */
function thinkingPreview(text) {
	const flat = text.replace(/\s+/g, " ").trim();
	if (!flat) return "";
	const tail = flat.slice(-160);
	const cut = tail.search(/[.!?:]\s+\S[^.!?:]*$/);
	return `…${(cut >= 0 ? tail.slice(cut + 1) : tail).trim()}`;
}

/** What a tool call is about to do, while the model is still writing its arguments. */
function toolPrepLabel(tool) {
	const file = (tool.target ?? "").split(/[\\/]/).pop();
	if (tool.name === "write") return file ? `Writing ${file}` : "Writing a file";
	if (tool.name === "edit") return file ? `Editing ${file}` : "Editing a file";
	if (tool.name === "read") return file ? `Reading ${file}` : "Reading a file";
	if (tool.name === "bash" || tool.name === "powershell") return "Preparing a command";
	return `Preparing ${tool.name || "a tool call"}`;
}

function setBusy(value) {
	busy = value;
	updateSend();
	updateWorking();
}

function updateSend() {
	const sendBtn = $("#send");
	const hasText = $("#input").value.trim().length > 0;
	const stop = busy && !hasText;
	sendBtn.innerHTML = icon(stop ? "stop" : "arrow", stop);
	sendBtn.title = stop ? "Stop" : busy ? "Steer: send after the current step" : "Send";
	sendBtn.disabled = !busy && !hasText;
}

// ---------------------------------------------------------------------------
// Live events
// ---------------------------------------------------------------------------

function onEvent(event) {
	switch (event.type) {
		case "agent_start":
			// pi echoes the user message after agent_start; that message opens the turn.
			if (!turn || !turn.running) needNewTurn = true;
			if (!busy) runStartedAt = phaseStartedAt = Date.now();
			setBusy(true);
			setPhase("thinking", "Thinking");
			break;
		case "agent_settled":
			runStartedAt = 0;
			workingDetail = "";
			queued = [];
			runningTools.clear();
			closeTurn(turn, Date.now());
			setBusy(false);
			settleAgentState();
			refreshAfterRun();
			break;
		case "message_start":
			if (event.message.role === "user") {
				if (turn && turn.running && turn.count === 0 && !turn.answer.childElementCount) turn.node.remove();
				else if (turn && !busy) closeTurn(turn, Date.now());
				needNewTurn = false;
				newTurn(textOf(event.message.content), Date.now());
				follow = true;
				keepAtBottom();
			}
			break;
		case "message_update": {
			const e = event.assistantMessageEvent;
			if (e?.type === "thinking_start") {
				thinkingTail = "";
				setPhase("thinking", "Thinking");
			} else if (e?.type === "thinking_delta") {
				thinkingTail = (thinkingTail + (e.delta ?? "")).slice(-600);
				if (agentState !== "thinking") setPhase("thinking", "Thinking");
				workingDetail = thinkingPreview(thinkingTail);
				updateWorking();
			} else if (e?.tool && (e.type === "toolcall_start" || e.type === "toolcall_delta")) {
				const label = toolPrepLabel(e.tool);
				const size = e.tool.chars > 2000 ? `${(e.tool.chars / 1000).toFixed(1)}k characters so far` : "";
				const command = e.tool.name === "bash" || e.tool.name === "powershell" ? (e.tool.target ?? "") : "";
				const detail = [command.replace(/\s+/g, " ").slice(0, 140), size].filter(Boolean).join(" · ");
				// One tool call is one step: the label sharpens as its target streams in, the step timer keeps running.
				if (e.type === "toolcall_start" || agentState !== "working") setPhase("working", label, detail);
				else {
					workingDetail = detail;
					setAgentState("working", label);
					updateWorking();
				}
			}
			if (e?.type === "text_delta") {
				if (agentState !== "generating") setPhase("generating", "Writing the reply");
				const t = ensureTurn();
				if (!t.current) {
					t.current = { el: el("div", "text"), text: "" };
					t.answer.append(t.current.el);
				}
				t.current.text += e.delta;
				t.current.el.textContent = t.current.text;
				updateWorking();
				keepAtBottom();
			}
			break;
		}
		case "message_end":
			if (event.message.role === "assistant") {
				const t = ensureTurn();
				addUsage(t, event.message.usage);
				const text = textOf(event.message.content);
				if (t.current) {
					if (text.trim()) renderMarkdown(t.current.el, text);
					else t.current.el.remove();
					t.current = null;
				} else addAnswerText(t, text);
				if (event.message.stopReason === "error" && event.message.errorMessage) {
					addNotice(t, event.message.errorMessage);
					setAgentState("error", "Failed");
				} else if (event.message.stopReason === "aborted") setAgentState("paused", "Stopped");
				updateWorking();
			}
			break;
		case "tool_execution_start":
			runningTools.set(event.toolCallId, event.toolName);
			{
				const a = event.args ?? {};
				const target = [a.path, a.file_path, a.command, a.url, a.query].find((v) => typeof v === "string") ?? "";
				setPhase(
					toolState(event.toolName),
					event.toolName === "update_plan" ? "Updating the plan" : `Running ${event.toolName}`,
					target.replace(/\s+/g, " ").slice(0, 140),
				);
			}
			if (!event.parentToolCallId) addStep(event.toolCallId, event.toolName, event.args);
			updateWorking();
			break;
		case "tool_execution_end":
			if (!event.parentToolCallId) finishStep(event.toolCallId, event.toolName, event.result, event.isError);
			runningTools.delete(event.toolCallId);
			if (busy) {
				// Tools can run in parallel: keep showing one that is still running.
				const still = [...runningTools.values()].at(-1);
				if (still) setPhase(toolState(still), `Running ${still}`);
				else setPhase("thinking", "Thinking");
			}
			break;
		case "queue_update":
			queued = [...(event.steering ?? []), ...(event.followUp ?? [])];
			updateWorking();
			break;
		case "auto_retry_start":
			if (busy) setPhase("thinking", "Retrying after a provider error", event.errorMessage ? String(event.errorMessage).slice(0, 140) : "");
			setStatus("retry", "retrying…");
			break;
		case "auto_retry_end":
			setStatus("retry");
			break;
		case "compaction_start":
			setStatus("compaction", "compacting…");
			break;
		case "compaction_end":
			setStatus("compaction");
			break;
	}
}

/** After a run: the session file now exists, so refresh the title and the chats list. */
async function refreshAfterRun() {
	refreshChatUsage();
	const state = await call({ type: "get_state" });
	if (state.success) {
		currentSession = state.data.sessionFile ?? currentSession;
		if (state.data.sessionName) chatTitle = state.data.sessionName;
	}
	if (chatTitle === "New chat") {
		const firstUser = chat.querySelector(".msg.user .bubble")?.textContent;
		if (firstUser) chatTitle = firstUser.replace(/\s+/g, " ").slice(0, 80);
	}
	if (mode === "chat") setCrumb(chatTitle);
	loadSessions();
}

const statuses = new Map();
function setStatus(key, text) {
	if (text) statuses.set(key, text);
	else statuses.delete(key);
	$("#status").replaceChildren(...[...statuses.values()].map((s) => el("span", "", s)));
}

// ---------------------------------------------------------------------------
// Extension UI: dialogs, notifications, widgets
// ---------------------------------------------------------------------------

const pendingDialogs = new Map();
let openDialogId = null;
const widgets = new Map();

function closeDialog(id) {
	pendingDialogs.delete(id);
	if (openDialogId === id) {
		openDialogId = null;
		$("#dialog").close();
		showNextDialog();
	}
}

function answer(id, payload) {
	rpc({ type: "extension_ui_response", id, ...payload });
	closeDialog(id);
	if (busy && !openDialogId) {
		setAgentState("thinking", "Thinking");
		updateWorking();
		keepAtBottom();
	}
}

function button(label, cls, onclick) {
	const b = el("button", cls, label);
	b.type = "button";
	b.onclick = onclick;
	return b;
}

// ---------------------------------------------------------------------------
// Questionnaire form (forge_ask): one question per step, checkboxes, select all, back/next
// ---------------------------------------------------------------------------

const QUESTIONNAIRE = "forge:questionnaire";

/** Returns false when the request is not a valid questionnaire (then it is shown as a plain editor). */
function showQuestionnaire(req) {
	let spec;
	try {
		spec = JSON.parse(req.prefill ?? "");
	} catch {
		return false;
	}
	const questions = Array.isArray(spec?.questions) ? spec.questions : [];
	if (questions.length === 0) return false;

	const state = questions.map(() => ({ picked: new Set(), other: "", text: "" }));
	let index = 0;
	const dialog = $("#dialog");
	const form = $("#dialog-form");
	dialog.classList.add("qform-dialog");

	const answered = (i) => {
		const st = state[i];
		return st.picked.size > 0 || st.other.trim() !== "" || st.text.trim() !== "";
	};
	const submit = () => {
		const answers = questions.map((q, i) => {
			const st = state[i];
			const values = (q.options?.length ? [...st.picked, st.other] : [st.text]).map((v) => v.trim()).filter(Boolean);
			return { id: q.id, values };
		});
		answer(req.id, { value: JSON.stringify({ answers }) });
	};
	const go = (i) => {
		index = Math.max(0, Math.min(questions.length - 1, i));
		render();
	};

	function optionRow(q, st, option, multi) {
		const row = el("label", "q-opt");
		const input = el("input");
		input.type = multi ? "checkbox" : "radio";
		input.name = `q-${q.id}`;
		input.checked = st.picked.has(option.label);
		input.onchange = () => {
			if (!multi) {
				st.picked.clear();
				st.other = "";
			}
			if (input.checked) st.picked.add(option.label);
			else st.picked.delete(option.label);
			render();
		};
		const box = el("span", `q-box ${multi ? "check" : "radio"}`);
		box.innerHTML = multi ? icon("check") : "";
		const text = el("span", "q-text");
		text.append(el("b", "", option.label));
		if (option.description) text.append(el("span", "", option.description));
		row.append(input, box, text);
		return row;
	}

	function render() {
		const q = questions[index];
		const st = state[index];
		const options = Array.isArray(q.options) ? q.options : [];
		const multi = Boolean(q.multi);
		const last = index === questions.length - 1;

		const head = el("div", "q-head");
		const titleRow = el("div", "q-title-row");
		titleRow.append(el("span", "q-title", spec.title ?? "A few questions"), el("span", "q-step", `Question ${index + 1} of ${questions.length}`));
		const dots = el("div", "q-dots");
		questions.forEach((_, i) => {
			const d = el("button", `q-dot${i === index ? " on" : ""}${answered(i) ? " done" : ""}`);
			d.type = "button";
			d.title = `Question ${i + 1}${answered(i) ? " (answered)" : ""}`;
			d.onclick = () => go(i);
			dots.append(d);
		});
		head.append(titleRow, dots);

		const body = el("div", "q-body");
		body.append(el("h2", "q-prompt", q.prompt));
		if (q.optional && options.length > 0) body.append(el("div", "q-hint", "Optional"));
		if (options.length > 0) {
			if (multi && options.length >= 4) {
				const bar = el("div", "q-bar");
				const count = el("span", "q-count", `${st.picked.size} of ${options.length} selected`);
				const all = button("Select all", "q-link", () => {
					for (const o of options) st.picked.add(o.label);
					render();
				});
				const none = button("Clear", "q-link", () => {
					st.picked.clear();
					render();
				});
				bar.append(count, all, none);
				body.append(bar);
			} else if (multi) body.append(el("div", "q-hint", "Choose any that apply"));
			const list = el("div", "q-options");
			for (const o of options) list.append(optionRow(q, st, o, multi));
			{
				// Every question with options also takes a typed answer.
				const row = el("div", "q-opt q-other");
				const box = el("span", `q-box ${multi ? "check" : "radio"}${st.other.trim() ? " filled" : ""}`);
				box.innerHTML = multi ? icon("check") : "";
				const input = el("input", "q-other-input");
				input.placeholder = q.placeholder ? `Other: ${q.placeholder}` : "Other: type your own answer";
				input.value = st.other;
				input.onkeydown = (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						last ? submit() : go(index + 1);
					}
				};
				input.oninput = () => {
					st.other = input.value;
					if (!multi && input.value.trim()) {
						st.picked.clear();
						for (const r of list.querySelectorAll('input[type="radio"]')) r.checked = false;
					}
					box.classList.toggle("filled", Boolean(input.value.trim()));
					dots.children[index]?.classList.toggle("done", answered(index));
				};
				row.append(box, input);
				list.append(row);
			}
			body.append(list);
		} else {
			const area = el("textarea", "q-textarea");
			area.placeholder = q.placeholder || "Type your answer";
			area.rows = q.optional ? 4 : 3;
			area.value = st.text;
			area.oninput = () => {
				st.text = area.value;
				dots.children[index]?.classList.toggle("done", answered(index));
			};
			area.onkeydown = (e) => {
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					last ? submit() : go(index + 1);
				}
			};
			body.append(area, el("div", "q-hint", `${q.optional ? "Optional. " : ""}Enter to ${last ? "submit" : "continue"} · Shift+Enter for a new line`));
			setTimeout(() => area.focus(), 0);
		}

		const foot = el("div", "q-foot");
		const cancel = button("Cancel", "btn", () => answer(req.id, { cancelled: true }));
		const spacer = el("div", "spacer");
		const back = button("Back", "btn", () => go(index - 1));
		back.disabled = index === 0;
		const next = button(last ? "Submit" : "Next", "btn primary", () => (last ? submit() : go(index + 1)));
		foot.append(cancel, spacer, back, next);

		form.replaceChildren(head, body, foot);
	}

	render();
	dialog.showModal();
	return true;
}

function showNextDialog() {
	if (replaying || openDialogId) return;
	const next = pendingDialogs.values().next().value;
	if (!next) return;
	if ($("#dialog").open) $("#dialog").close();
	openDialogId = next.id;
	if (busy) setAgentState("listening", "Waiting for your answer");
	$("#dialog").classList.remove("qform-dialog");
	if (next.method === "editor" && next.title === QUESTIONNAIRE && showQuestionnaire(next)) return;
	const form = $("#dialog-form");
	form.replaceChildren(el("h2", "", next.title ?? "Question"));
	if (next.message) form.append(el("div", "muted", next.message));
	const row = el("div", "row");

	if (next.method === "select") {
		const options = el("div", "options");
		for (const option of next.options ?? []) options.append(button(option, "", () => answer(next.id, { value: option })));
		form.append(options);
		row.append(button("Cancel", "btn", () => answer(next.id, { cancelled: true })));
		setTimeout(() => options.querySelector("button")?.focus(), 0);
	} else if (next.method === "confirm") {
		const yes = button("Yes", "btn primary", () => answer(next.id, { confirmed: true }));
		row.append(button("No", "btn", () => answer(next.id, { confirmed: false })), yes);
		setTimeout(() => yes.focus(), 0);
	} else {
		const field = next.method === "editor" ? el("textarea") : el("input");
		if (next.method === "editor") {
			field.rows = 10;
			field.value = next.prefill ?? "";
		} else field.placeholder = next.placeholder ?? "";
		const ok = button("OK", "btn primary", () => answer(next.id, { value: field.value }));
		field.onkeydown = (e) => {
			if (e.key === "Enter" && next.method !== "editor") {
				e.preventDefault();
				ok.click();
			}
		};
		form.append(field);
		row.append(button("Cancel", "btn", () => answer(next.id, { cancelled: true })), ok);
		setTimeout(() => field.focus(), 0);
	}
	form.append(row);
	$("#dialog").showModal();
}

// Every dialog answers through its own buttons. Without this, Enter in a lone text box submits the
// method="dialog" form natively, which closes the dialog without sending the answer.
$("#dialog-form").addEventListener("submit", (e) => e.preventDefault());

$("#dialog").addEventListener("cancel", (e) => {
	e.preventDefault();
	if (openDialogId) answer(openDialogId, { cancelled: true });
	else $("#dialog").close();
});

function showInfo(title, lines) {
	if (openDialogId) return;
	const form = $("#dialog-form");
	const row = el("div", "row");
	row.append(button("Close", "btn primary", () => $("#dialog").close()));
	form.replaceChildren(el("h2", "", title), ...lines.map((l) => el("div", "muted", l)), row);
	$("#dialog").showModal();
}

function renderWidgets() {
	const box = $("#widgets");
	box.replaceChildren();
	for (const [key, lines] of widgets) {
		if (key.startsWith("forge-")) continue; // panels and the plan render from tool results instead
		const w = el("div", "panel widget");
		w.append(el("h3", "", key));
		const body = el("div", "body");
		body.append(el("pre", "", lines.join("\n")));
		w.append(body);
		box.append(w);
	}
	updateSide();
}

function onUiRequest(r) {
	switch (r.method) {
		case "select":
		case "confirm":
		case "input":
		case "editor":
			pendingDialogs.set(r.id, r);
			showNextDialog();
			break;
		case "notify":
			if (!replaying) toast(r.message, r.notifyType ?? "info");
			break;
		case "setStatus":
			setStatus(`ext-${r.statusKey}`, r.statusText);
			break;
		case "setWidget":
			if (r.widgetLines) widgets.set(r.widgetKey, r.widgetLines);
			else widgets.delete(r.widgetKey);
			renderWidgets();
			break;
		case "set_editor_text":
			$("#input").value = r.text ?? "";
			autosize();
			break;
	}
}

// ---------------------------------------------------------------------------
// Menus: + (commands and skills), model, more
// ---------------------------------------------------------------------------

const menu = $("#menu");
function openMenu(anchor, build, align = "left") {
	if (!menu.hidden && menu.dataset.anchor === anchor.id) return closeMenu();
	menu.replaceChildren();
	menu.dataset.anchor = anchor.id;
	build(menu);
	menu.hidden = false;
	const r = anchor.getBoundingClientRect();
	const m = menu.getBoundingClientRect();
	const left = align === "right" ? r.right - m.width : r.left;
	menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - m.width - 8))}px`;
	const above = r.top - m.height - 8;
	menu.style.top = `${above > 8 ? above : r.bottom + 8}px`;
}
function closeMenu() {
	menu.hidden = true;
	menu.dataset.anchor = "";
}
document.addEventListener("mousedown", (e) => {
	if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(`#${menu.dataset.anchor}`)) closeMenu();
});
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && !menu.hidden) closeMenu();
});
function menuItem(label, onclick, opts = {}) {
	const b = el("button");
	b.type = "button";
	if (opts.icon) b.insertAdjacentHTML("beforeend", icon(opts.icon));
	if (opts.check !== undefined) {
		const check = el("span", "check");
		if (opts.check) check.innerHTML = icon("check");
		b.append(check);
	}
	b.append(el("span", "", label));
	if (opts.sub) b.append(el("span", "sub", opts.sub));
	b.onclick = () => {
		closeMenu();
		onclick();
	};
	return b;
}

$("#plus").onclick = async () => {
	const res = await call({ type: "get_commands" });
	const commands = res.success ? (res.data.commands ?? []) : [];
	openMenu($("#plus"), (m) => {
		m.append(
			menuItem("New chat", () => $("#new").click(), { icon: "edit" }),
			menuItem("Compact conversation", () => call({ type: "compact" }), { icon: "compress", sub: "summarize older turns" }),
			menuItem("Views", () => setMode("views"), { icon: "views" }),
		);
		if (commands.length > 0) {
			m.append(el("hr"), el("div", "menu-label", "Skills and commands"));
			for (const c of commands) {
				m.append(
					menuItem(
						`/${c.name}`,
						() => {
							$("#input").value = `/${c.name} `;
							autosize();
							$("#input").focus();
						},
						{ icon: c.source === "skill" ? "skill" : c.source === "prompt" ? "prompt" : "command", sub: c.description ?? c.source },
					),
				);
			}
		}
	});
};

$("#level-btn").onclick = async () => {
	const [levels, state] = await Promise.all([call({ type: "get_available_thinking_levels" }), call({ type: "get_state" })]);
	const list = levels.success ? (levels.data.levels ?? []) : [];
	openMenu(
		$("#level-btn"),
		(m) => {
			m.append(el("div", "menu-label", "Thinking level"));
			if (list.length <= 1) m.append(el("div", "menu-label", "This model has no thinking levels."));
			for (const level of list) {
				m.append(
					menuItem(
						level[0].toUpperCase() + level.slice(1),
						async () => {
							await call({ type: "set_thinking_level", level });
							applyState((await call({ type: "get_state" })).data);
						},
						{ check: level === state.data?.thinkingLevel },
					),
				);
			}
		},
		"right",
	);
};

$("#model-btn").onclick = async () => {
	if (noProvider) return setMode("settings");
	const [models, state] = await Promise.all([call({ type: "get_available_models" }), call({ type: "get_state" })]);
	const currentModel = state.data?.model;
	const all = models.success ? (models.data.models ?? []) : [];
	const isCurrent = (x) => x.id === currentModel?.id && x.provider === currentModel?.provider;
	openMenu(
		$("#model-btn"),
		(m) => {
			m.append(el("div", "menu-label", "Model"));
			const filter = el("input");
			filter.placeholder = "Filter models";
			const list = el("div");
			const draw = () => {
				const q = filter.value.trim().toLowerCase();
				const pool = all
					.filter((x) => (q ? `${x.name} ${x.id} ${x.provider}`.toLowerCase().includes(q) : x.provider === currentModel?.provider))
					.sort((p, n) => Number(isCurrent(n)) - Number(isCurrent(p)) || (p.name ?? p.id).localeCompare(n.name ?? n.id));
				list.replaceChildren(
					...pool.slice(0, 40).map((x) =>
						menuItem(
							x.name ?? x.id,
							async () => {
								const r = await call({ type: "set_model", provider: x.provider, modelId: x.id });
								if (!r.success) toast(`Model: ${r.error}`, "error");
								applyState((await call({ type: "get_state" })).data);
							},
							{ check: isCurrent(x), sub: x.id },
						),
					),
				);
				if (pool.length === 0) list.append(el("div", "menu-label", "No models match"));
			};
			filter.oninput = draw;
			m.append(filter, list);
			draw();
			setTimeout(() => filter.focus(), 0);
		},
		"right",
	);
};

$("#more").onclick = () => {
	openMenu(
		$("#more"),
		(m) => {
			m.append(
				menuItem("Rename chat", () => renameChat(), { icon: "rename" }),
				menuItem(
					"Copy last answer",
					() => {
						const last = [...chat.querySelectorAll(".msg.assistant .text")].at(-1);
						if (last) navigator.clipboard.writeText(last.innerText).then(() => toast("Copied"));
					},
					{ icon: "copy" },
				),
				menuItem("New chat", () => $("#new").click(), { icon: "edit" }),
			);
		},
		"right",
	);
};

function renameChat() {
	if (openDialogId) return;
	const form = $("#dialog-form");
	const field = el("input");
	field.value = chatTitle === "New chat" ? "" : chatTitle;
	const save = async () => {
		const name = field.value.trim();
		$("#dialog").close();
		if (!name) return;
		const res = await call({ type: "set_session_name", name });
		if (res.success) {
			chatTitle = name;
			setCrumb(name);
			loadSessions();
		} else toast(`Rename failed: ${res.error}`, "error");
	};
	field.onkeydown = (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			save();
		}
	};
	const row = el("div", "row");
	row.append(button("Cancel", "btn", () => $("#dialog").close()), button("Save", "btn primary", save));
	form.replaceChildren(el("h2", "", "Rename chat"), field, row);
	$("#dialog").showModal();
	setTimeout(() => field.focus(), 0);
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function autosize() {
	const input = $("#input");
	input.style.height = "auto";
	const max = window.innerHeight * 0.4;
	input.style.height = `${Math.min(input.scrollHeight, max)}px`;
	input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
	updateSend();
}

function send(text) {
	const message = text.trim();
	if (!message) return;
	follow = true;
	if (mode !== "chat") setMode("chat");
	if (busy) {
		queued = [...queued, message];
		updateWorking();
	}
	rpc(busy ? { type: "prompt", message, streamingBehavior: "steer" } : { type: "prompt", message });
}

$("#composer").addEventListener("submit", (e) => {
	e.preventDefault();
	const value = $("#input").value;
	if (busy && !value.trim()) {
		rpc({ type: "abort" });
		return;
	}
	if (noProvider && value.trim()) {
		// Keep the message; it can be sent once a key is added.
		toast("Add a model provider key first: Settings → Model providers.", "error");
		setMode("settings");
		return;
	}
	send(value);
	$("#input").value = "";
	autosize();
});
$("#input").addEventListener("input", autosize);
$("#input").addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
		e.preventDefault();
		if ($("#input").value.trim()) $("#composer").requestSubmit();
	} else if (e.key === "Escape" && busy) {
		rpc({ type: "abort" });
	}
});

// ---------------------------------------------------------------------------
// Event stream
// ---------------------------------------------------------------------------

function handle(event) {
	if (event.type === "response" && event.id && calls.has(event.id)) {
		const resolve = calls.get(event.id);
		calls.delete(event.id);
		resolve(event);
		return;
	}
	switch (event.type) {
		case "forge_replay_done":
			replaying = false;
			reloadChat().then(() => showNextDialog());
			return;
		case "forge_schedule":
			if (replaying) return;
			if (event.status === "running") toast(`Scheduled run started: ${event.name}`);
			else if (event.status === "done") toast(`Scheduled run finished: ${event.name} (${fmtCost(event.cost ?? 0)})`);
			else toast(`Scheduled run failed: ${event.name}. ${event.error ?? ""}`, "error");
			if (event.status !== "running") loadSessions();
			if (mode === "schedules") renderPage("schedules");
			return;
		case "forge_harness_updated":
			if (!replaying) harnessUpdated(event);
			return;
		case "forge_agent_restarted":
			setTimeout(async () => {
				await reloadChat();
				if (mode === "settings") renderPage("settings");
				toast("Agent restarted with the new settings.");
			}, 600);
			return;
		case "forge_ui_answered":
			closeDialog(event.id);
			return;
		case "forge_exit":
			setBusy(false);
			toast("The harness process exited. Restart it to continue.", "error");
			return;
		case "extension_ui_request":
			onUiRequest(event);
			return;
		case "response":
			if (!event.success && !replaying && event.command !== "abort") toast(`${event.command}: ${event.error}`, "error");
			return;
	}
	// Chat events from the replay are not drawn (the transcript comes from get_messages), but they rebuild the status.
	if (replaying) replayStatus(event);
	else onEvent(event);
}

const events = new EventSource(`/api/events?token=${token}${BUILD ? "&agent=builder" : ""}`);
events.onmessage = (msg) => {
	try {
		handle(JSON.parse(msg.data));
	} catch (error) {
		console.error("bad event", error, msg.data);
	}
};
events.onerror = () => setStatus("conn", "reconnecting…");
events.onopen = () => {
	setStatus("conn");
	replaying = true;
	runStartedAt = 0;
	queued = [];
	runningTools.clear();
	if (!chat.querySelector(".turn, .msg")) showChatSkeleton();
	pendingDialogs.clear();
	if (openDialogId) {
		openDialogId = null;
		$("#dialog").close();
	}
};

renderSessions();
setMode(location.pathname === "/preview" ? "views" : "chat");
updateSend();
