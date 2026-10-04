import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { ImageGalleryData } from "./types.ts";

/** Terminal fallback: numbered captions and URLs (images themselves show in the web UI). */
export function galleryLines(data: ImageGalleryData, theme: Theme, expanded: boolean): string[] {
	const out = [theme.bold(`${data.title ?? "Images"} · ${data.images.length}`)];
	const shown = expanded ? data.images : data.images.slice(0, 4);
	shown.forEach((img, i) => {
		out.push(`${theme.fg("accent", `${i + 1}.`)} ${img.caption ?? ""} ${theme.fg("dim", img.url)}`);
	});
	if (shown.length < data.images.length) out.push(theme.fg("dim", `… ${data.images.length - shown.length} more`));
	out.push(theme.fg("dim", "Open the web UI to see the images."));
	return out;
}

export function renderTui(data: ImageGalleryData, theme: Theme, expanded: boolean): Component {
	return {
		render: (width: number) => galleryLines(data, theme, expanded).map((l) => truncateToWidth(l, width)),
		invalidate() {},
	};
}

export function summarize(data: ImageGalleryData): string {
	return `${data.title ?? "images"}: ${data.images.length} image(s)`;
}
