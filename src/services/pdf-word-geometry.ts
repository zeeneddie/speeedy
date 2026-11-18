/**
 * Links the reader's words on one PDF page to where they stand on that page.
 *
 * Pure and DOM-free: the viewer feeds it pdf.js text items and the reader's
 * tokens for the page, and gets back, per token, the rectangles it covers in
 * PDF user space (origin bottom-left). A token that cannot be found nearby
 * gets null — the viewer then marks only the page, never a wrong word.
 */

/** A pdf.js text item reduced to what the alignment needs (PDF user space). */
export interface PdfTextItem {
	str: string;
	/** Left edge of the item. */
	x: number;
	/** Baseline of the item. */
	y: number;
	/** Advance width of the whole item. */
	w: number;
	/** Height of the item (≈ font size). */
	h: number;
}

/** Axis-aligned rectangle in PDF user space: x0 < x1, y0 (bottom) < y1 (top). */
export interface PdfRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** How far (in normalized characters) a token may lie beyond the previous match. */
const SEARCH_WINDOW = 400;

/** Lowercased letters and digits only, with accents and ligatures decomposed. */
export function normalizeForMatch(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Converts a pdf.js text item (`transform` = [a, b, c, d, e, f]) into a {@link PdfTextItem}. */
export function toPdfTextItem(item: {
	str: string;
	transform: number[];
	width: number;
	height: number;
}): PdfTextItem {
	const [, , c, d, e, f] = item.transform;
	const fontHeight = item.height || Math.hypot(c, d) || 10;
	return { str: item.str, x: e, y: f, w: item.width, h: fontHeight };
}

interface CharRef {
	ch: string;
	item: number;
	offset: number;
}

/**
 * For each token, the rectangles it covers on the page, or null when it could not be placed.
 * Tokens are matched in order; a token that is not found within {@link SEARCH_WINDOW}
 * characters after the previous match is skipped without moving on, so one odd token
 * (a citation the reader split differently, a running header) does not derail the rest.
 */
export function alignTokensToItems(
	tokens: string[],
	items: PdfTextItem[],
): (PdfRect[] | null)[] {
	const chars: CharRef[] = [];
	items.forEach((item, itemIndex) => {
		[...item.str].forEach((raw, offset) => {
			for (const ch of normalizeForMatch(raw)) {
				chars.push({ ch, item: itemIndex, offset });
			}
		});
	});
	const haystack = chars.map((c) => c.ch).join("");

	let cursor = 0;
	return tokens.map((token) => {
		const needle = normalizeForMatch(token);
		if (!needle) return null;
		const at = haystack.indexOf(needle, cursor);
		if (at < 0 || at - cursor > SEARCH_WINDOW) return null;
		cursor = at + needle.length;
		return rectsForRange(chars, items, at, cursor - 1);
	});
}

function rectsForRange(
	chars: CharRef[],
	items: PdfTextItem[],
	first: number,
	last: number,
): PdfRect[] {
	const rects: PdfRect[] = [];
	let i = first;
	while (i <= last) {
		const itemIndex = chars[i].item;
		const startOffset = chars[i].offset;
		let endOffset = startOffset;
		while (i <= last && chars[i].item === itemIndex) {
			endOffset = chars[i].offset;
			i++;
		}
		const item = items[itemIndex];
		const length = Math.max([...item.str].length, 1);
		const charWidth = item.w / length;
		rects.push({
			x0: item.x + charWidth * startOffset,
			x1: item.x + charWidth * (endOffset + 1),
			y0: item.y - item.h * 0.2,
			y1: item.y + item.h * 0.85,
		});
	}
	return rects;
}

/**
 * Index (into `rects`) of the token at a point in PDF user space: the token whose
 * rectangle contains the point, else the nearest one within `maxDistance`; -1 if none.
 */
export function tokenAtPoint(
	rects: (PdfRect[] | null)[],
	x: number,
	y: number,
	maxDistance = 20,
): number {
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	rects.forEach((tokenRects, index) => {
		for (const r of tokenRects ?? []) {
			const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
			const dy = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
			const distance = Math.hypot(dx, dy);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = index;
			}
		}
	});
	return bestDistance <= maxDistance ? best : -1;
}
