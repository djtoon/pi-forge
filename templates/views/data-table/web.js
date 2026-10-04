// Web renderer for the data-table view: sortable table; rows can open another view (rowLink).
// Contract: export function render(el, data, ctx) -> optional cleanup function.

export function render(el, data, ctx) {
	el.classList.add("v-table");
	let sortCol = -1;
	let sortDir = 1;

	const draw = () => {
		const rows = [...data.rows];
		if (sortCol >= 0) {
			rows.sort((a, b) => {
				const x = a[sortCol];
				const y = b[sortCol];
				if (x === y) return 0;
				if (x === null || x === undefined) return 1;
				if (y === null || y === undefined) return -1;
				return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir;
			});
		}
		const table = document.createElement("table");
		const head = table.createTHead().insertRow();
		data.columns.forEach((col, i) => {
			const th = document.createElement("th");
			th.textContent = col + (i === sortCol ? (sortDir > 0 ? " ▲" : " ▼") : "");
			th.onclick = () => {
				sortDir = i === sortCol ? -sortDir : 1;
				sortCol = i;
				draw();
			};
			head.append(th);
		});
		const body = table.createTBody();
		const linkCol = data.rowLink ? data.columns.indexOf(data.rowLink.column) : -1;
		for (const row of rows) {
			const tr = body.insertRow();
			row.forEach((value, i) => {
				const td = tr.insertCell();
				td.textContent = value === null || value === undefined ? "–" : typeof value === "number" ? String(Number(value.toFixed(3))) : value;
				if (typeof value === "number") td.className = "num";
			});
			if (linkCol >= 0 && row[linkCol] !== null && ctx.openView) {
				tr.classList.add("link");
				tr.title = `Open in ${data.rowLink.view} view`;
				tr.onclick = () => ctx.openView(data.rowLink.view, row[linkCol]);
			}
		}
		const parts = [];
		if (data.title) {
			const h = document.createElement("div");
			h.className = "v-title";
			h.textContent = `${data.title} · ${data.rows.length} rows`;
			parts.push(h);
		}
		const wrap = document.createElement("div");
		wrap.className = "v-table-wrap";
		wrap.append(table);
		parts.push(wrap);
		el.replaceChildren(...parts);
	};
	draw();
}
