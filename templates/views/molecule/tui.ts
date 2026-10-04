import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { MoleculeData } from "./types.ts";

function fmt(value: number | undefined, digits = 2): string {
	return value === undefined ? "–" : String(Number(value.toFixed(digits)));
}

/** Terminal fallback for the molecule view: identity line, SMILES, and (expanded) a property grid. */
export function moleculeLines(data: MoleculeData, theme: Theme, expanded: boolean): string[] {
	const head =
		`${theme.fg("accent", "⬡ ")}${theme.bold(data.name)}  ` +
		`${theme.fg("text", data.formula)}  ` +
		`${theme.fg("muted", `${fmt(data.weight)} g/mol`)}  ` +
		theme.fg("dim", `CID ${data.cid}`);
	const lines = [head, `  ${theme.fg("dim", "SMILES")} ${data.smiles}`];
	if (!expanded) return lines;

	if (data.iupac) lines.push(`  ${theme.fg("dim", "IUPAC ")} ${data.iupac}`);
	const props: [string, string][] = [
		["XLogP", fmt(data.xlogp, 1)],
		["TPSA", data.tpsa === undefined ? "–" : `${fmt(data.tpsa, 1)} Å²`],
		["H-donors", fmt(data.hbondDonors, 0)],
		["H-acceptors", fmt(data.hbondAcceptors, 0)],
		["Rot. bonds", fmt(data.rotatableBonds, 0)],
		["Charge", fmt(data.charge, 0)],
		["Heavy atoms", fmt(data.heavyAtoms, 0)],
		["Structure", data.sdf ? `${data.sdfDimensions ?? "2d"} coordinates` : "none"],
	];
	for (let i = 0; i < props.length; i += 2) {
		const cell = ([k, v]: [string, string]) => `${theme.fg("dim", k.padEnd(12))}${v.padEnd(12)}`;
		lines.push(`  ${props.slice(i, i + 2).map(cell).join("  ")}`);
	}
	if (data.sourceUrl) lines.push(`  ${theme.fg("dim", data.sourceUrl)}`);
	lines.push(`  ${theme.fg("dim", "3D view: open the web UI")}`);
	return lines;
}

export function renderTui(data: MoleculeData, theme: Theme, expanded: boolean): Component {
	return {
		render: (width: number) => moleculeLines(data, theme, expanded).map((line) => truncateToWidth(line, width)),
		invalidate() {},
	};
}

/** One line, for panels in non-terminal clients and logs. */
export function summarize(data: MoleculeData): string {
	return `${data.name} ${data.formula} (CID ${data.cid}, ${fmt(data.weight)} g/mol)`;
}
