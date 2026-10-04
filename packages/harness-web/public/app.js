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
	const res = await fetch("/api/rpc", {
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
const panelViews = new Map(config.views.filter((v) => v.panel).map((v) => [v.id, v]));
let mode = "chat"; // chat | harnesses | views | tools
let chatTitle = "New chat";
let panelsOpen = window.innerWidth >= 1300;
let panelsTouched = false; // the user toggled the side card themselves

const PAGES = {
	harnesses: { title: "Harnesses", nav: "#go-harnesses" },
	views: { title: config.isForge ? "View catalog" : "Views", nav: "#go-views" },
	tools: { title: "Tools", nav: "#go-tools" },
	settings: { title: "Settings", nav: null },
};
$("#go-harnesses").hidden = !config.isForge;
$("#go-tools").hidden = config.isForge;

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
	history.replaceState(null, "", next === "views" ? "/preview" : "/");
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

	page.append(appearance, providers, about);

	const [statusRes, models] = await Promise.all([
		fetch("/api/credentials", { headers: { "x-forge-token": token } }),
		call({ type: "get_available_models" }),
	]);
	const status = statusRes.ok ? await statusRes.json() : [];
	const counts = {};
	for (const m of models.success ? (models.data.models ?? []) : []) counts[m.provider] = (counts[m.provider] ?? 0) + 1;
	for (const p of status) grid.append(providerCard(p, counts[p.id] ?? 0));
}

function providerCard(p, modelCount) {
	const card = el("div", "card provider");
	const head = el("div", "card-head");
	head.append(el("b", "", p.label));
	const saved = p.fields.some((f) => f.source === "saved");
	const fromEnv = p.fields.some((f) => f.source === "environment");
	let badgeText = "Not set";
	if (modelCount > 0) badgeText = `Key set · ${modelCount} models`;
	else if (saved) badgeText = "Saved · no models found";
	else if (fromEnv) badgeText = "From environment";
	const badge = el("span", `badge${modelCount > 0 ? " ok" : ""}`, badgeText);
	head.append(badge);
	card.append(head);
	if (p.note) card.append(el("p", "note", p.note));

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
		await saveCredentials(p, values);
	});
	actions.append(save);
	if (saved) {
		actions.append(
			button("Remove saved", "btn small", async () => {
				const values = {};
				for (const f of p.fields) if (f.source === "saved") values[f.env] = null;
				await saveCredentials(p, values);
			}),
		);
	}
	card.append(actions);
	return card;
}

async function saveCredentials(p, values) {
	if (busy) return toast("Wait for the agent to finish, then save.", "warning");
	const res = await fetch("/api/credentials", {
		method: "POST",
		headers: { "content-type": "application/json", "x-forge-token": token },
		body: JSON.stringify({ provider: p.id, values, sessionPath: currentSession }),
	});
	if (!res.ok) return toast(`Could not save: ${await res.text()}`, "error");
	toast(`${p.label} saved. Restarting the agent…`);
	// The forge_agent_restarted event reloads the chat and this page.
}

async function renderPage(which) {
	const page = $("#page");
	if (which === "settings") return renderSettings(page);
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

async function loadSessions() {
	const res = await fetch("/api/sessions", { headers: { "x-forge-token": token } });
	if (res.ok) sessions = await res.json();
	renderSessions();
}

function renderSessions() {
	const query = $("#search").value.trim().toLowerCase();
	const list = $("#sessions");
	const shown = sessions.filter((s) => !query || s.title.toLowerCase().includes(query));
	list.replaceChildren();
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
	if (config.web?.eyebrow) box.append(el("div", "eyebrow", config.web.eyebrow));
	box.append(el("h1", "", config.web?.headline ?? config.title));
	const sub = config.web?.subtitle ?? config.description;
	if (sub) box.append(el("p", "sub", sub));

	const actions = el("div", "actions");
	if (noProvider) {
		const setup = actionCard("settings", "Set up a model provider", "Add an Anthropic, OpenAI or AWS Bedrock key to start", () => setMode("settings"));
		setup.classList.add("setup");
		actions.append(setup);
	}
	if (config.isForge) {
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
	if (config.web?.tagline) box.append(el("div", "tagline", config.web.tagline));
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
	turn = { node, worked, stateHost, label, list, outputs: outputsEl, answer, start: ts ?? Date.now(), end: 0, count: 0, files: new Map(), filesCard: null, current: null, running: true };
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
	const m = data?.model;
	$("#model-name").textContent = noProvider ? "Set up a model" : m ?(m.name ?? m.id).replace(/\s*\((Global|US|EU)\)\s*$/, "") : "No model";
	$("#model-level").textContent = data?.thinkingLevel ?? "off";
	currentSession = data?.sessionFile ?? "";
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

// Working line while the agent works and nothing else shows it yet (no steps, no streaming text).
function updateWorking() {
	const existing = chat.querySelector(".working");
	const show = busy && !turn?.current?.text;
	if (show && !existing) {
		removeWelcome();
		const line = el("div", "working");
		line.append(aiState(agentState, 20), el("span", "working-label", agentLabel));
		chat.append(line);
		keepAtBottom();
	} else if (!show && existing) existing.remove();
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
			setAgentState("thinking", "Thinking");
			setBusy(true);
			break;
		case "agent_settled":
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
			if (e?.type === "text_delta") {
				if (agentState !== "generating") setAgentState("generating", "Writing");
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
			setAgentState(toolState(event.toolName), event.toolName === "update_plan" ? "Planning" : `Using ${event.toolName}`);
			if (!event.parentToolCallId) addStep(event.toolCallId, event.toolName, event.args);
			updateWorking();
			break;
		case "tool_execution_end":
			if (!event.parentToolCallId) finishStep(event.toolCallId, event.toolName, event.result, event.isError);
			runningTools.delete(event.toolCallId);
			if (busy) {
				// Tools can run in parallel: keep showing one that is still running.
				const still = [...runningTools.values()].at(-1);
				if (still) setAgentState(toolState(still), `Using ${still}`);
				else setAgentState("thinking", "Thinking");
			}
			break;
		case "auto_retry_start":
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
			if (q.allow_other !== false) {
				const row = el("div", "q-opt q-other");
				const box = el("span", `q-box ${multi ? "check" : "radio"}${st.other.trim() ? " filled" : ""}`);
				box.innerHTML = multi ? icon("check") : "";
				const input = el("input", "q-other-input");
				input.placeholder = q.placeholder || "Other: type your own";
				input.value = st.other;
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
			area.rows = 3;
			area.placeholder = q.placeholder || "Type your answer";
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
			body.append(area);
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
		case "forge_agent_restarted":
			setTimeout(async () => {
				await reloadChat();
				if (mode === "settings") renderPage("settings");
				toast("Agent restarted with the new keys.");
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
	// Chat events from the replay are skipped: the transcript comes from get_messages instead.
	if (!replaying) onEvent(event);
}

const events = new EventSource(`/api/events?token=${token}`);
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
	pendingDialogs.clear();
	if (openDialogId) {
		openDialogId = null;
		$("#dialog").close();
	}
};

setMode(location.pathname === "/preview" ? "views" : "chat");
updateSend();
