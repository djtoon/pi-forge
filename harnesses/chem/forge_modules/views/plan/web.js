// Web renderer for the plan view: progress header and a checklist. The web UI also uses this markup
// (class names v-plan-*) for the Plan section of the side card.
// Contract: export function render(el, data, ctx) -> optional cleanup function.

const SPRITE = "/icons-sprite.svg";

function icon(name) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "i");
	svg.setAttribute("aria-hidden", "true");
	const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
	use.setAttribute("href", `${SPRITE}#icon-${name}`);
	svg.append(use);
	return svg;
}

export function render(el, data) {
	el.classList.add("v-plan");
	const steps = data.steps ?? [];
	const counted = steps.filter((s) => s.status !== "skipped");
	const done = steps.filter((s) => s.status === "done").length;

	const head = document.createElement("div");
	head.className = "v-plan-head";
	const count = document.createElement("span");
	count.className = "v-plan-count";
	count.textContent = `${done} of ${counted.length} done`;
	const bar = document.createElement("div");
	bar.className = "v-plan-bar";
	const fill = document.createElement("i");
	fill.style.width = `${counted.length ? Math.round((done / counted.length) * 100) : 0}%`;
	bar.append(fill);
	head.append(count, bar);

	const parts = [head];
	if (data.explanation) {
		const note = document.createElement("div");
		note.className = "v-plan-note";
		note.textContent = data.explanation;
		parts.push(note);
	}

	const list = document.createElement("ol");
	list.className = "v-plan-list";
	for (const s of steps) {
		const li = document.createElement("li");
		li.className = `v-plan-step ${s.status}`;
		const mark = document.createElement("span");
		mark.className = "v-plan-mark";
		if (s.status === "in_progress") {
			const live = document.createElement("ai-state");
			live.setAttribute("state", "working");
			live.setAttribute("size", "16");
			mark.append(live);
		} else {
			mark.append(icon(s.status === "done" ? "check-circle-filled" : s.status === "skipped" ? "circle-dot" : "circle"));
		}
		const text = document.createElement("span");
		text.className = "v-plan-text";
		text.textContent = s.step;
		li.append(mark, text);
		list.append(li);
	}
	parts.push(list);
	el.replaceChildren(...parts);
}
