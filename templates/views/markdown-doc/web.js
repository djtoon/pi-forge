// Web renderer for the markdown-doc view: rendered, sanitized markdown.
// Contract: export function render(el, data, ctx) -> optional cleanup function.

const MARKED = "https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js";
const PURIFY = "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js";

export function render(el, data, ctx) {
	el.classList.add("v-doc");
	const pre = document.createElement("pre");
	pre.textContent = data.markdown;
	el.replaceChildren(pre);
	Promise.all([ctx.loadScript(MARKED), ctx.loadScript(PURIFY)])
		.then(() => {
			const article = document.createElement("article");
			article.innerHTML = window.DOMPurify.sanitize(window.marked.parse(data.markdown));
			for (const a of article.querySelectorAll("a")) {
				a.target = "_blank";
				a.rel = "noopener";
			}
			el.replaceChildren(article);
		})
		.catch(() => {
			/* offline: keep the plain-text fallback */
		});
}
