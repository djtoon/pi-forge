// Web renderer for the image-gallery view: responsive grid, click to enlarge.
// Contract: export function render(el, data, ctx) -> optional cleanup function.

export function render(el, data) {
	el.classList.add("v-gallery");
	const grid = document.createElement("div");
	grid.className = "v-gallery-grid";
	for (const image of data.images) {
		const fig = document.createElement("figure");
		const img = document.createElement("img");
		img.src = image.url;
		img.alt = image.caption ?? "";
		img.loading = "lazy";
		img.onclick = () => {
			const big = document.createElement("div");
			big.className = "v-lightbox";
			const full = document.createElement("img");
			full.src = image.url;
			big.append(full);
			big.onclick = () => big.remove();
			document.body.append(big);
		};
		fig.append(img);
		if (image.caption) {
			const cap = document.createElement("figcaption");
			cap.textContent = image.caption;
			fig.append(cap);
		}
		grid.append(fig);
	}
	const parts = [];
	if (data.title) {
		const h = document.createElement("div");
		h.className = "v-title";
		h.textContent = data.title;
		parts.push(h);
	}
	parts.push(grid);
	el.replaceChildren(...parts);
}
