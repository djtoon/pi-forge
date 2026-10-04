// Web renderer for the diff view: one collapsible block per file, colored lines.
// Contract: export function render(el, data, ctx) -> optional cleanup function.

export function render(el, data) {
	el.classList.add("v-diff");
	const parts = [];
	if (data.title) {
		const h = document.createElement("div");
		h.className = "v-title";
		h.textContent = data.title;
		parts.push(h);
	}
	for (const file of data.files) {
		const details = document.createElement("details");
		details.open = true;
		const summary = document.createElement("summary");
		summary.textContent = file.path;
		const pre = document.createElement("pre");
		for (const line of file.patch.split("\n")) {
			if (line.startsWith("---") || line.startsWith("+++")) continue;
			const span = document.createElement("span");
			span.className = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : "";
			span.textContent = `${line}\n`;
			pre.append(span);
		}
		details.append(summary, pre);
		parts.push(details);
	}
	el.replaceChildren(...parts);
}
