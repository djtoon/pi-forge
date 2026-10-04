// Web renderer for the chart view: dependency-free SVG bar/line chart with legend and hover values.
// Contract: export function render(el, data, ctx) -> optional cleanup function.

const NS = "http://www.w3.org/2000/svg";
const PALETTE = ["accent", "#7aa2f7", "#e0af68", "#9ece6a", "#f7768e", "#bb9af7"];

function svg(tag, attrs, parent) {
	const node = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	parent?.append(node);
	return node;
}

export function render(el, data, ctx) {
	el.classList.add("v-chart");
	const color = (i) => (PALETTE[i % PALETTE.length] === "accent" ? ctx.theme.accent : PALETTE[i % PALETTE.length]);
	const W = 640;
	const H = 280;
	const pad = { l: 48, r: 12, t: 12, b: 40 };
	const values = data.series.flatMap((s) => s.values.filter((v) => v !== null));
	const max = Math.max(0, ...values);
	const min = Math.min(0, ...values);
	const span = max - min || 1;
	const y = (v) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
	const n = data.labels.length;
	const band = (W - pad.l - pad.r) / Math.max(1, n);

	const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": data.title ?? "chart" });
	for (let k = 0; k <= 4; k++) {
		const v = min + (span * k) / 4;
		svg("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "grid" }, root);
		const t = svg("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" }, root);
		t.textContent = Number(v.toFixed(2)).toString();
	}
	// Show at most ~12 x labels so they never overlap; every point still has a hover title.
	const every = Math.max(1, Math.ceil(n / 12));
	data.labels.forEach((label, i) => {
		if (i % every !== 0 && i !== n - 1) return;
		const t = svg("text", { x: pad.l + band * (i + 0.5), y: H - pad.b + 18, "text-anchor": "middle", class: "axis" }, root);
		t.textContent = label.length > 12 ? `${label.slice(0, 11)}…` : label;
	});

	const unit = data.unit ? ` ${data.unit}` : "";
	data.series.forEach((s, si) => {
		if (data.kind === "line") {
			const pts = s.values.map((v, i) => (v === null ? null : [pad.l + band * (i + 0.5), y(v)])).filter(Boolean);
			svg("polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: "none", stroke: color(si), "stroke-width": 2 }, root);
			pts.forEach((p, i) => {
				const c = svg("circle", { cx: p[0], cy: p[1], r: 3.5, fill: color(si) }, root);
				svg("title", {}, c).textContent = `${s.name} · ${data.labels[i]}: ${s.values[i]}${unit}`;
			});
		} else {
			const bw = (band * 0.8) / data.series.length;
			s.values.forEach((v, i) => {
				if (v === null) return;
				const x = pad.l + band * i + band * 0.1 + bw * si;
				const r = svg("rect", { x, y: Math.min(y(v), y(0)), width: Math.max(1, bw - 2), height: Math.abs(y(v) - y(0)), rx: 2, fill: color(si) }, root);
				svg("title", {}, r).textContent = `${s.name} · ${data.labels[i]}: ${v}${unit}`;
			});
		}
	});

	const parts = [];
	if (data.title) {
		const h = document.createElement("div");
		h.className = "v-title";
		h.textContent = data.title;
		parts.push(h);
	}
	parts.push(root);
	if (data.series.length > 1) {
		const legend = document.createElement("div");
		legend.className = "v-legend";
		data.series.forEach((s, i) => {
			const item = document.createElement("span");
			const swatch = document.createElement("i");
			swatch.style.background = color(i);
			item.append(swatch, document.createTextNode(s.name));
			legend.append(item);
		});
		parts.push(legend);
	}
	el.replaceChildren(...parts);
}
