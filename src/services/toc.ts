import type { TocEntry } from "../models/types.js";
import { computePageStarts, pageForWord } from "./page-map.js";
import { normalizeForMatch } from "./pdf-word-geometry.js";
import { tokenize } from "./rsvp-engine.js";

/** A part of the document text, optionally opened by a heading. */
export interface TextSegment {
	text: string;
	heading?: { title: string; level: number };
}

/**
 * Table of contents from text segments whose concatenation (joined with blank
 * lines) is the document text. Each heading starts at the first word of its
 * segment. Returns [] when the segments do not add up to the text (never a
 * heading at the wrong place).
 */
export function tocFromSegments(
	segments: TextSegment[],
	fullText: string,
): TocEntry[] {
	const starts = computePageStarts(
		segments.map((s) => s.text),
		fullText,
	);
	if (!starts) return [];
	const toc: TocEntry[] = [];
	segments.forEach((segment, i) => {
		if (!segment.heading) return;
		toc.push({
			title: segment.heading.title,
			level: segment.heading.level,
			startWord: starts[i],
			page: null,
		});
	});
	return toc;
}

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Splits Markdown into segments at heading lines (`#`, `##`, …). */
export function markdownSegments(text: string): TextSegment[] {
	const segments: TextSegment[] = [{ text: "" }];
	for (const line of text.split("\n")) {
		const match = MD_HEADING.exec(line);
		if (match) {
			segments.push({
				text: `${line}\n`,
				heading: { title: match[2], level: match[1].length },
			});
		} else {
			segments[segments.length - 1].text += `${line}\n`;
		}
	}
	return segments.filter((s, i) => i > 0 || s.text.trim());
}

/**
 * Word index of the first occurrence of `title` within [from, to) of the
 * (normalized) tokens; `from` when it is not found.
 */
export function refineStart(
	normalizedTokens: string[],
	from: number,
	to: number,
	title: string,
): number {
	const words = title
		.split(/\s+/)
		.map(normalizeForMatch)
		.filter(Boolean)
		.slice(0, 8);
	if (words.length === 0) return from;
	for (let i = from; i < Math.min(to, normalizedTokens.length); i++) {
		let n = 0;
		while (n < words.length && normalizedTokens[i + n] === words[n]) n++;
		if (n === words.length) return i;
	}
	return from;
}

/** The parts of pdf.js the outline needs (kept small so it can be tested without a PDF). */
export interface PdfOutlineSource {
	getOutline(): Promise<PdfOutlineNode[] | null>;
	getDestination(id: string): Promise<unknown[] | null>;
	getPageIndex(ref: unknown): Promise<number>;
}

export interface PdfOutlineNode {
	title: string;
	dest: string | unknown[] | null;
	items: PdfOutlineNode[];
}

/**
 * Table of contents from a PDF's built-in outline. Each entry starts at its
 * target page, refined to the heading's words on that page when found there.
 * Entries without a resolvable page are left out. [] when there is no outline
 * or the pages cannot be mapped to the text.
 */
export async function pdfToc(
	pdf: PdfOutlineSource,
	pages: string[],
	fullText: string,
): Promise<TocEntry[]> {
	const outline = await pdf.getOutline().catch(() => null);
	if (!outline?.length) return [];
	const starts = computePageStarts(pages, fullText);
	if (!starts) return [];
	const tokens = tokenize(fullText).map((t) => normalizeForMatch(t.text));

	const resolvePage = async (dest: PdfOutlineNode["dest"]) => {
		try {
			const explicit =
				typeof dest === "string" ? await pdf.getDestination(dest) : dest;
			if (!explicit?.length) return null;
			const ref = explicit[0];
			return typeof ref === "number" ? ref : await pdf.getPageIndex(ref);
		} catch {
			return null;
		}
	};

	const toc: TocEntry[] = [];
	// An outline runs in document order: search each heading from the previous one on,
	// so a mention of a later heading's words earlier on the page is not taken for it.
	let previous = 0;
	const walk = async (nodes: PdfOutlineNode[], level: number) => {
		for (const node of nodes) {
			const page = await resolvePage(node.dest);
			if (page !== null && page >= 0 && page < starts.length) {
				const pageEnd =
					page + 1 < starts.length ? starts[page + 1] : tokens.length;
				const from = Math.min(Math.max(starts[page], previous), pageEnd);
				const startWord = refineStart(tokens, from, pageEnd, node.title);
				previous = startWord;
				toc.push({ title: node.title.trim(), level, startWord, page });
			}
			if (node.items?.length) await walk(node.items, level + 1);
		}
	};
	await walk(outline, 1);
	return toc;
}

/** Page (0-based) of each entry, from the page starts, for entries that have none (e.g. EPUB/Markdown never do). */
export function withPages(
	toc: TocEntry[],
	pageStarts: number[] | null,
): TocEntry[] {
	if (!pageStarts) return toc;
	return toc.map((e) => ({
		...e,
		page: e.page ?? pageForWord(pageStarts, e.startWord),
	}));
}
