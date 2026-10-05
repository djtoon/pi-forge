#!/usr/bin/env node
/**
 * Package a harness as a standalone program (no Node, npm, or forge checkout needed to run it):
 *
 *   npm run package -- harnesses/chem [--target windows-x64|linux-x64|linux-arm64|darwin-arm64|darwin-x64] [--out dir] [--desktop] [--zip]
 *
 *   --desktop   put the folder on this computer's Desktop (<Desktop>/<name>-<target>)
 *   --zip       also write <folder>.zip (or .tar.gz where zip isn't available) next to it, ready to share
 *
 * Output folder dist/<name>-<target>/:
 *   <name>(.exe)        Bun-compiled executable: pi + harness-core + web server
 *   <name>-web(.cmd)    double-click launcher for the browser UI
 *   harness/            the harness folder (spec, extensions, views, skills, theme); pi loads it from here
 *   web/                the web UI files
 *   theme/ assets/ export-html/ package.json photon_rs_bg.wasm   files pi expects next to its binary
 *   README.txt
 * Settings, chats and provider keys stay in ~/.forge on the machine that runs it.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSpec } from "@forge/harness-spec";
import { REPO_ROOT } from "./index.ts";

export const TARGETS = ["windows-x64", "windows-arm64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"] as const;
export type Target = (typeof TARGETS)[number];

/** Folders inside a harness that hold work output, not the harness itself. */
const OUTPUT_DIRS = new Set(["node_modules", "models", "designs", "exports", "sprites", ".forge"]);

export interface PackResult {
	outDir: string;
	executable: string;
	sizeMb: number;
	target: Target;
}

export function hostTarget(): Target {
	const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	return `${os}-${arch}` as Target;
}

/** The Bun executable, called directly (no shell, so paths with spaces are safe). */
function findBun(): string | undefined {
	const exe = process.platform === "win32" ? "bun.exe" : "bun";
	const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
	const candidates = [
		process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", exe) : "",
		join(home, ".bun", "bin", exe),
		process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "bun", "bin", exe) : "",
		...(process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").map((d) => (d ? join(d, exe) : "")),
	];
	return candidates.find((c) => c && existsSync(c) && spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0);
}

/** This computer's Desktop folder (on Windows it can live in OneDrive), else the home folder. */
export function desktopDir(): string {
	if (process.platform === "win32") {
		const r = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8" });
		const dir = r.stdout?.trim();
		if (r.status === 0 && dir && existsSync(dir)) return dir;
	}
	const desktop = join(homedir(), "Desktop");
	return existsSync(desktop) ? desktop : homedir();
}

/** Archive a package folder next to itself: .zip via tar -a (Windows 10+, macOS) or zip, else .tar.gz. */
export function archiveFolder(dir: string): string {
	const parent = dirname(dir);
	const name = basename(dir);
	const zip = join(parent, `${name}.zip`);
	rmSync(zip, { force: true });
	const tarZip = spawnSync("tar", ["-a", "-c", "-f", zip, "-C", parent, name], { encoding: "utf8" });
	if (tarZip.status === 0 && existsSync(zip)) return zip;
	const zipCmd = spawnSync("zip", ["-qr", zip, name], { cwd: parent, encoding: "utf8" });
	if (zipCmd.status === 0 && existsSync(zip)) return zip;
	const tgz = join(parent, `${name}.tar.gz`);
	const tar = spawnSync("tar", ["-czf", tgz, "-C", parent, name], { encoding: "utf8" });
	if (tar.status === 0 && existsSync(tgz)) return tgz;
	throw new Error(`Could not archive ${dir}: ${(tarZip.stderr || tar.stderr || "no tar or zip found").trim()}`);
}

function folderSize(dir: string): number {
	let total = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		total += entry.isDirectory() ? folderSize(p) : statSync(p).size;
	}
	return total;
}

function rel(from: string, to: string): string {
	const r = relative(from, to).replace(/\\/g, "/");
	return r.startsWith(".") ? r : `./${r}`;
}

export function packHarness(harnessDir: string, options: { target?: Target; outDir?: string } = {}): PackResult {
	const dir = resolve(harnessDir);
	const spec = loadSpec(dir);
	const target = options.target ?? hostTarget();
	if (!TARGETS.includes(target)) throw new Error(`Unknown target "${target}". Use one of: ${TARGETS.join(", ")}`);
	const bun = findBun();
	if (!bun) throw new Error("Packaging needs Bun (https://bun.sh). Install it, then run this again.");
	if (!existsSync(join(dir, "bin"))) throw new Error(`${spec.name} is not generated yet: run forge_generate first.`);

	const piDir = join(REPO_ROOT, "node_modules", "@earendil-works", "pi-coding-agent");
	const piDist = join(piDir, "dist");
	const outDir = resolve(options.outDir ?? join(REPO_ROOT, "dist", `${spec.name}-${target}`));
	const buildDir = join(REPO_ROOT, "dist", ".build", spec.name);
	const windows = target.startsWith("windows");
	const exeName = windows ? `${spec.name}.exe` : spec.name;

	rmSync(outDir, { recursive: true, force: true });
	rmSync(buildDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	mkdirSync(buildDir, { recursive: true });

	// 1. Entry: pi's Bun runtime setup (Bedrock provider, embedded wasm), then the packaged-harness launcher.
	const entry = join(buildDir, "entry.ts");
	writeFileSync(
		entry,
		[
			`import "${rel(buildDir, join(piDist, "bun", "sandbox-env-setup.js"))}";`,
			`import "${rel(buildDir, join(piDist, "bun", "runtime-setup.js"))}";`,
			`import { runPackagedHarness } from "${rel(buildDir, join(REPO_ROOT, "packages", "harness-core", "src", "index.ts"))}";`,
			"",
			"await runPackagedHarness();",
			"",
		].join("\n"),
	);

	// 2. Compile. pi's worker scripts are extra entry points so they are embedded too.
	const workers = [join(piDist, "utils", "image-resize-worker.js"), join(piDist, "extensions", "codemode", "worker.js")].filter((f) => existsSync(f));
	// The repo tsconfig maps pi packages to their type declarations (for tsc); the build must use the real code.
	const tsconfig = join(buildDir, "tsconfig.json");
	writeFileSync(tsconfig, "{}\n");
	const args = ["build", "--compile", "--no-compile-autoload-bunfig", `--tsconfig-override=${tsconfig}`, entry, ...workers, "--outfile", join(outDir, exeName), `--target=bun-${target}`];
	const build = spawnSync(bun, args, { cwd: REPO_ROOT, encoding: "utf8" });
	if (build.status !== 0) throw new Error(`bun build failed:\n${(build.stderr || build.stdout).slice(-3000)}`);

	// 3. Files pi expects next to its binary (same layout as pi's own release).
	cpSync(join(piDir, "package.json"), join(outDir, "package.json"));
	cpSync(join(piDist, "modes", "interactive", "theme"), join(outDir, "theme"), { recursive: true, filter: (p) => statSync(p).isDirectory() || p.endsWith(".json") });
	if (existsSync(join(piDist, "modes", "interactive", "assets"))) cpSync(join(piDist, "modes", "interactive", "assets"), join(outDir, "assets"), { recursive: true });
	mkdirSync(join(outDir, "export-html"), { recursive: true });
	for (const f of ["template.html", "template.css", "template.js"]) {
		const src = join(piDist, "core", "export-html", f);
		if (existsSync(src)) cpSync(src, join(outDir, "export-html", f));
	}
	if (existsSync(join(piDist, "core", "export-html", "vendor"))) cpSync(join(piDist, "core", "export-html", "vendor"), join(outDir, "export-html", "vendor"), { recursive: true });
	const wasm = [join(piDir, "node_modules", "@silvia-odwyer", "photon-node", "photon_rs_bg.wasm"), join(REPO_ROOT, "node_modules", "@silvia-odwyer", "photon-node", "photon_rs_bg.wasm")].find((f) => existsSync(f));
	if (wasm) cpSync(wasm, join(outDir, "photon_rs_bg.wasm"));

	// 4. Web UI and the harness itself.
	cpSync(join(REPO_ROOT, "packages", "harness-web", "public"), join(outDir, "web"), { recursive: true });
	cpSync(dir, join(outDir, "harness"), {
		recursive: true,
		filter: (p) => !OUTPUT_DIRS.has(relative(dir, p).split(/[\\/]/)[0] ?? ""),
	});

	// Licenses travel with the program (it bundles pi, Bun, and the icon pack).
	for (const f of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) if (existsSync(join(REPO_ROOT, f))) cpSync(join(REPO_ROOT, f), join(outDir, f));

	// 5. Launchers and a short README.
	const title = spec.title ?? spec.name;
	if (windows) {
		writeFileSync(join(outDir, `${spec.name}-web.cmd`), `@echo off\r\n"%~dp0${exeName}" web %*\r\n`);
	} else {
		writeFileSync(join(outDir, `${spec.name}-web`), `#!/bin/sh\nexec "$(dirname "$0")/${exeName}" web "$@"\n`, { mode: 0o755 });
	}
	const run = windows ? `${exeName}` : `./${exeName}`;
	writeFileSync(
		join(outDir, "README.txt"),
		[
			`${title} (built with pi-Forge)`,
			"",
			`${spec.description ?? ""}`,
			"",
			"Run",
			`  ${run} web            browser UI (or double-click ${spec.name}-web${windows ? ".cmd" : ""})`,
			`  ${run}                terminal UI`,
			`  ${run} -p "question"  headless answer`,
			`  ${run} --mode json    headless event stream`,
			"",
			"Model provider keys: in the browser UI open Settings (gear, bottom left), or set them in the",
			"environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, AWS_* for Bedrock, ...).",
			"Chats, settings and keys are stored in ~/.forge on this computer.",
			"Keep the files in this folder together: the program loads harness/, web/ and theme/ from next to itself.",
			...(windows
				? []
				: [
						"",
						"First run on macOS or Linux: make the program executable, in this folder:",
						`  chmod +x ${exeName} ${spec.name}-web`,
						...(target.startsWith("darwin")
							? ["macOS may say the app is from an unidentified developer. Allow it with:", "  xattr -dr com.apple.quarantine ."]
							: []),
					]),
			"",
		].join(windows ? "\r\n" : "\n"),
	);

	rmSync(buildDir, { recursive: true, force: true });
	return { outDir, executable: join(outDir, exeName), sizeMb: Math.round(folderSize(outDir) / 1048576), target };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const argv = process.argv.slice(2);
	const dir = argv.find((a) => !a.startsWith("--"));
	const flag = (name: string) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	if (!dir) {
		console.error(`usage: npm run package -- <harness-dir> [--target ${TARGETS.join("|")}] [--out dir]`);
		process.exit(2);
	}
	try {
		const target = flag("--target") as Target | undefined;
		let outDir = flag("--out");
		if (!outDir && argv.includes("--desktop")) outDir = join(desktopDir(), `${loadSpec(resolve(dir)).name}-${target ?? hostTarget()}`);
		const result = packHarness(dir, { target, outDir });
		console.log(`packaged ${result.outDir} (${result.target}, ${result.sizeMb} MB)`);
		console.log(`run: ${relative(process.cwd(), result.executable)} web`);
		if (argv.includes("--zip")) console.log(`archive ${archiveFolder(result.outDir)}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

