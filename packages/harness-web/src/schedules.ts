import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Schedules: prompts a harness runs on its own, saved in <agent dir>/schedules.json. While the harness's web UI is
 * running, a timer starts each due schedule as a headless run (`<harness> -p "<prompt>" --name "<label>"`), which pi
 * saves as a normal chat. Runs that come due while the UI is closed are skipped, not caught up.
 */

export type Repeat = "daily" | "weekdays" | "weekly" | "hourly";

export interface Schedule {
	id: string;
	name: string;
	prompt: string;
	repeat: Repeat;
	/** "HH:MM", local time (daily, weekdays, weekly) */
	time: string;
	/** 0 = Sunday … 6 = Saturday (weekly) */
	day?: number;
	/** Every N hours (hourly) */
	every?: number;
	enabled: boolean;
	created: number;
	lastRun?: { at: number; ok: boolean; sessionPath?: string; error?: string; cost?: number; ms?: number };
}

const REPEATS: Repeat[] = ["daily", "weekdays", "weekly", "hourly"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function schedulesFile(agentDir: string): string {
	return join(agentDir, "schedules.json");
}

export function readSchedules(agentDir: string): Schedule[] {
	const file = schedulesFile(agentDir);
	if (!existsSync(file)) return [];
	try {
		return ((JSON.parse(readFileSync(file, "utf8")) as { schedules?: Schedule[] }).schedules ?? []).filter((s) => s && s.id);
	} catch {
		return [];
	}
}

function writeSchedules(agentDir: string, schedules: Schedule[]): void {
	const file = schedulesFile(agentDir);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ version: 1, schedules }, null, "\t")}\n`);
}

/** The next time a schedule runs after `from` (ms), or undefined when it is off. */
export function nextRun(s: Schedule, from = Date.now()): number | undefined {
	if (!s.enabled) return undefined;
	if (s.repeat === "hourly") {
		const every = Math.max(1, s.every ?? 1) * 3_600_000;
		const base = s.lastRun?.at ?? s.created;
		let next = base + every;
		while (next <= from) next += every;
		return next;
	}
	const [hh = 9, mm = 0] = s.time.split(":").map(Number);
	const d = new Date(from);
	d.setSeconds(0, 0);
	d.setHours(hh, mm);
	for (let i = 0; i < 8; i++) {
		const candidate = new Date(d.getTime());
		candidate.setDate(d.getDate() + i);
		if (candidate.getTime() <= from) continue;
		const wd = candidate.getDay();
		if (s.repeat === "weekdays" && (wd === 0 || wd === 6)) continue;
		if (s.repeat === "weekly" && wd !== (s.day ?? 1)) continue;
		return candidate.getTime();
	}
	return undefined;
}

export function describeRepeat(s: Schedule): string {
	if (s.repeat === "hourly") return (s.every ?? 1) === 1 ? "Every hour" : `Every ${s.every} hours`;
	if (s.repeat === "weekdays") return `Weekdays at ${s.time}`;
	if (s.repeat === "weekly") return `Every ${DAY_NAMES[s.day ?? 1]} at ${s.time}`;
	return `Every day at ${s.time}`;
}

export function saveSchedule(agentDir: string, input: Record<string, unknown>): Schedule {
	const name = String(input.name ?? "").trim().slice(0, 80);
	const prompt = String(input.prompt ?? "").trim();
	if (!name) throw new Error("Give the schedule a name");
	if (!prompt) throw new Error("Write the prompt to run");
	if (prompt.length > 8000) throw new Error("The prompt is too long (8000 characters max)");
	const repeat = String(input.repeat ?? "daily") as Repeat;
	if (!REPEATS.includes(repeat)) throw new Error("Repeat must be daily, weekdays, weekly or hourly");
	const time = String(input.time ?? "09:00");
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Time must be HH:MM (24-hour)");
	const day = Number(input.day ?? 1);
	if (repeat === "weekly" && !(day >= 0 && day <= 6)) throw new Error("Pick a day of the week");
	const every = Math.round(Number(input.every ?? 1));
	if (repeat === "hourly" && !(every >= 1 && every <= 168)) throw new Error("Every 1 to 168 hours");

	const schedules = readSchedules(agentDir);
	const id = typeof input.id === "string" && input.id ? input.id : `s${Date.now().toString(36)}`;
	const before = schedules.find((s) => s.id === id);
	const schedule: Schedule = {
		id,
		name,
		prompt,
		repeat,
		time,
		...(repeat === "weekly" ? { day } : {}),
		...(repeat === "hourly" ? { every } : {}),
		enabled: input.enabled !== false,
		created: before?.created ?? Date.now(),
		...(before?.lastRun ? { lastRun: before.lastRun } : {}),
	};
	writeSchedules(agentDir, before ? schedules.map((s) => (s.id === id ? schedule : s)) : [...schedules, schedule]);
	return schedule;
}

export function removeSchedule(agentDir: string, id: string): void {
	writeSchedules(
		agentDir,
		readSchedules(agentDir).filter((s) => s.id !== id),
	);
}

function recordRun(agentDir: string, id: string, lastRun: Schedule["lastRun"]): void {
	writeSchedules(
		agentDir,
		readSchedules(agentDir).map((s) => (s.id === id ? { ...s, lastRun } : s)),
	);
}

/** Sum of the reply costs in one session file. */
function sessionCost(file: string): number {
	let cost = 0;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.includes('"usage"')) continue;
		try {
			const m = (JSON.parse(line) as { message?: { role?: string; usage?: { cost?: { total?: number } } } }).message;
			if (m?.role === "assistant") cost += m.usage?.cost?.total ?? 0;
		} catch {
			// partial line
		}
	}
	return cost;
}

/** The session file pi wrote for a run: the newest .jsonl in the folder changed since the run started. */
function findRunSession(dir: string | undefined, since: number): string | undefined {
	if (!dir || !existsSync(dir)) return undefined;
	return readdirSync(dir)
		.filter((f) => f.endsWith(".jsonl"))
		.map((f) => join(dir, f))
		.filter((f) => statSync(f).mtimeMs >= since - 1000)
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export interface SchedulerOptions {
	agentDir: string;
	/** The harness launcher: [execPath, ...args] runs the harness (plus pi arguments). */
	launcher: { command: string; args: string[]; cwd: string };
	/** Where pi saves this harness's chats, to find the run's session. */
	sessionDir: string | undefined;
	/** A run started or finished (for the page). */
	onEvent: (event: Record<string, unknown>) => void;
}

/** Runs due schedules every 30 seconds; `runNow` starts one immediately. One run per schedule at a time. */
export function startScheduler(opts: SchedulerOptions) {
	const running = new Set<string>();
	// When each schedule is next due. Computed from now when first seen or when its timing changes, so runs missed
	// while the UI was closed are skipped rather than all fired at once.
	const due = new Map<string, { at: number; sig: string }>();
	const plan = () => {
		const schedules = readSchedules(opts.agentDir);
		for (const s of schedules) {
			const sig = JSON.stringify([s.repeat, s.time, s.day, s.every, s.enabled]);
			const known = due.get(s.id);
			if (known && known.sig === sig) continue;
			const at = nextRun(s);
			if (at === undefined) due.delete(s.id);
			else due.set(s.id, { at, sig });
		}
		for (const id of [...due.keys()]) if (!schedules.some((s) => s.id === id)) due.delete(id);
	};

	const run = (s: Schedule) => {
		if (running.has(s.id)) return false;
		running.add(s.id);
		const started = Date.now();
		const label = `⏰ ${s.name} · ${new Date(started).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
		opts.onEvent({ type: "forge_schedule", id: s.id, name: s.name, status: "running" });
		const child = spawn(opts.launcher.command, [...opts.launcher.args, "-p", s.prompt, "--name", label], {
			cwd: opts.launcher.cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let errText = "";
		child.stderr.on("data", (d: Buffer) => {
			errText = (errText + d.toString("utf8")).slice(-4000);
		});
		child.stdout.resume();
		const timeout = setTimeout(() => child.kill(), 60 * 60_000); // an hour at most
		const finish = (ok: boolean, error?: string) => {
			clearTimeout(timeout);
			running.delete(s.id);
			const sessionPath = findRunSession(opts.sessionDir, started);
			const result = { at: started, ok, ms: Date.now() - started, ...(sessionPath ? { sessionPath, cost: sessionCost(sessionPath) } : {}), ...(error ? { error } : {}) };
			recordRun(opts.agentDir, s.id, result);
			due.delete(s.id);
			plan();
			opts.onEvent({ type: "forge_schedule", id: s.id, name: s.name, status: ok ? "done" : "failed", ...result });
		};
		child.on("close", (code) => {
			const lines = errText.split("\n").filter((l) => l.trim() && !/ExperimentalWarning|--trace-warnings/.test(l));
			finish(code === 0, code === 0 ? undefined : (lines.at(-1) ?? `exited with code ${code}`).slice(0, 400));
		});
		child.on("error", (e) => finish(false, e.message));
		return true;
	};

	plan();
	const timer = setInterval(() => {
		plan();
		const now = Date.now();
		for (const s of readSchedules(opts.agentDir)) {
			const at = due.get(s.id)?.at;
			if (s.enabled && at !== undefined && at <= now) run(s);
		}
	}, 30_000);
	timer.unref();

	return {
		running,
		replan: plan,
		next: (id: string) => due.get(id)?.at,
		runNow(id: string): boolean {
			const s = readSchedules(opts.agentDir).find((x) => x.id === id);
			if (!s) throw new Error("No such schedule");
			return run(s);
		},
		stop: () => clearInterval(timer),
	};
}
