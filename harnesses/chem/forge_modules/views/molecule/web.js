// Web renderer for the molecule view: interactive 3D structure (3Dmol.js) + properties.
// Contract: export function render(el, data, ctx) -> optional cleanup function.
// ctx: { theme: { accent, fg, muted, bg, panel, border, dark }, expanded, loadScript(url), openView(id, data) }

const THREE_D_MOL = "https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/3Dmol-min.js";

const STYLES = {
	stick: { stick: { radius: 0.16 } },
	"ball & stick": { stick: { radius: 0.12 }, sphere: { scale: 0.25 } },
	sphere: { sphere: { scale: 0.9 } },
	line: { line: {} },
};

function fmt(v, digits = 2) {
	return v === undefined || v === null ? "–" : String(Number(Number(v).toFixed(digits)));
}

export function render(el, data, ctx) {
	el.classList.add("v-molecule");
	const props = [
		["Formula", data.formula],
		["MW", `${fmt(data.weight)} g/mol`],
		["XLogP", fmt(data.xlogp, 1)],
		["TPSA", data.tpsa === undefined ? "–" : `${fmt(data.tpsa, 1)} Å²`],
		["H-donors", fmt(data.hbondDonors, 0)],
		["H-acceptors", fmt(data.hbondAcceptors, 0)],
		["Rot. bonds", fmt(data.rotatableBonds, 0)],
		["Charge", fmt(data.charge, 0)],
	];
	el.innerHTML = `
		<div class="v-mol-head">
			<strong class="v-mol-name"></strong>
			<span class="v-mol-cid"></span>
			${data.sourceUrl ? `<a class="v-mol-link" target="_blank" rel="noopener">PubChem ↗</a>` : ""}
		</div>
		<div class="v-mol-body">
			<div class="v-mol-stage"><div class="v-mol-3d"></div><div class="v-mol-tools"></div></div>
			<dl class="v-mol-props"></dl>
		</div>
		<div class="v-mol-smiles"></div>`;
	el.querySelector(".v-mol-name").textContent = data.name;
	el.querySelector(".v-mol-cid").textContent = `CID ${data.cid}`;
	const link = el.querySelector(".v-mol-link");
	if (link) link.href = data.sourceUrl;
	el.querySelector(".v-mol-smiles").textContent = data.smiles;
	const dl = el.querySelector(".v-mol-props");
	for (const [k, v] of props) {
		const dt = document.createElement("dt");
		dt.textContent = k;
		const dd = document.createElement("dd");
		dd.textContent = v;
		dl.append(dt, dd);
	}

	const stage = el.querySelector(".v-mol-3d");
	const tools = el.querySelector(".v-mol-tools");
	let viewer;
	let disposed = false;

	const fallback2d = (reason) => {
		if (data.imageUrl) {
			const img = document.createElement("img");
			img.src = data.imageUrl;
			img.alt = `${data.name} 2D structure`;
			stage.replaceChildren(img);
		} else {
			stage.textContent = reason;
		}
	};

	if (!data.sdf) {
		fallback2d("No structure file");
		return;
	}

	ctx.loadScript(THREE_D_MOL)
		.then(() => {
			if (disposed) return;
			const $3Dmol = window.$3Dmol;
			viewer = $3Dmol.createViewer(stage, { backgroundColor: ctx.theme.panel, antialias: true });
			viewer.addModel(data.sdf, "sdf");
			let current = "ball & stick";
			const apply = () => {
				viewer.setStyle({}, STYLES[current]);
				viewer.render();
			};
			apply();
			viewer.zoomTo();
			viewer.render();
			for (const name of Object.keys(STYLES)) {
				const b = document.createElement("button");
				b.textContent = name;
				b.className = name === current ? "on" : "";
				b.onclick = () => {
					current = name;
					for (const other of tools.querySelectorAll("button")) other.className = other === b ? "on" : "";
					apply();
				};
				tools.append(b);
			}
			const spin = document.createElement("button");
			spin.textContent = "spin";
			let spinning = false;
			spin.onclick = () => {
				spinning = !spinning;
				spin.className = spinning ? "on" : "";
				viewer.spin(spinning ? "y" : false);
			};
			tools.append(spin);
			if (data.sdfDimensions === "2d") {
				const note = document.createElement("span");
				note.className = "v-note";
				note.textContent = "2D coordinates only";
				tools.append(note);
			}
		})
		.catch(() => fallback2d("3D viewer unavailable (offline?)"));

	return () => {
		disposed = true;
		viewer?.clear?.();
	};
}
