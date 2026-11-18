import type { ReaderSettings } from "../models/types.js";
import { tokenize } from "./rsvp-engine.js";

/**
 * Word index at which each source page starts, in the token stream the reader plays.
 *
 * `prepare` is the same transformation the reader applies before tokenizing
 * (e.g. citation stripping), applied per page. Returns null when the per-page
 * word counts do not add up to the reader's total — callers then fall back to
 * "no page mapping" rather than pointing at the wrong page.
 */
export function computePageStarts(
	pages: string[],
	fullText: string,
	prepare: (text: string) => string = (t) => t,
	settings?: ReaderSettings,
): number[] | null {
	if (pages.length === 0) return null;

	const starts: number[] = [];
	let offset = 0;
	for (const page of pages) {
		starts.push(offset);
		offset += tokenize(prepare(page), settings).length;
	}

	const total = tokenize(prepare(fullText), settings).length;
	return offset === total ? starts : null;
}

/** 0-based page index containing `wordIndex`, given the starts from {@link computePageStarts}. */
export function pageForWord(starts: number[], wordIndex: number): number {
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (starts[mid] <= wordIndex) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}
