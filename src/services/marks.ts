import type { Mark, MarkPrep } from "../models/types.js";
import { stripCitations } from "../utils/text-utils.js";
import { normalizeForMatch } from "./pdf-word-geometry.js";
import type { WordToken } from "./rsvp-engine.js";

/** A word that ends a sentence: . ! ? (and CJK/Arabic forms), optionally followed by closing quotes or brackets. */
const SENTENCE_END_RE = /[.!?。！？؟]["'”’»)\]]*$/u;

/** Words in a mark's quote kept for matching; long sentences are matched on their opening words. */
const QUOTE_WORDS = 40;

/** Extra words in the text (e.g. citations the quote did not have) tolerated inside one match. */
const MAX_SKIPPED_WORDS = 6;

/** First and last word index of the sentence containing `index`. Paragraph starts also begin a sentence. */
export function sentenceBounds(
	tokens: WordToken[],
	index: number,
): [number, number] {
	if (tokens.length === 0) return [0, 0];
	const at = Math.min(Math.max(index, 0), tokens.length - 1);
	let start = at;
	while (
		start > 0 &&
		!tokens[start].context?.paragraphStart &&
		!SENTENCE_END_RE.test(tokens[start - 1].text)
	) {
		start--;
	}
	let end = at;
	while (
		end < tokens.length - 1 &&
		!SENTENCE_END_RE.test(tokens[end].text) &&
		!tokens[end + 1].context?.paragraphStart
	) {
		end++;
	}
	return [start, end];
}

/** A mark placed on the reader's current token stream. `start`/`end` are null when its place was not found. */
export interface ResolvedMark {
	mark: Mark;
	start: number | null;
	end: number | null;
}

function quoteOf(tokens: WordToken[], start: number, end: number): string {
	return tokens
		.slice(start, Math.min(end + 1, start + QUOTE_WORDS))
		.map((t) => t.text)
		.join(" ");
}

/** Creates a mark for the sentence containing `index`. */
export function createMark(
	tokens: WordToken[],
	index: number,
	prep: MarkPrep,
	page: number | null,
): Mark {
	const [start, end] = sentenceBounds(tokens, index);
	return {
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		page,
		startWord: start,
		endWord: end,
		prep,
		quote: quoteOf(tokens, start, end),
	};
}

function normalizedWords(text: string): string[] {
	return text
		.split(/\s+/)
		.map(normalizeForMatch)
		.filter((w) => w.length > 0);
}

/**
 * Places marks on the current token stream. A mark made with the same text
 * preparation keeps its word indices when its quote still matches there;
 * otherwise its quote is searched (nearest to where it was). Not found → null.
 */
export function resolveMarks(
	marks: Mark[],
	tokens: WordToken[],
	prep: MarkPrep,
): ResolvedMark[] {
	const norm = tokens.map((t) => normalizeForMatch(t.text));
	return marks.map((mark) => {
		if (mark.prep === prep && mark.endWord < tokens.length) {
			if (quoteOf(tokens, mark.startWord, mark.endWord) === mark.quote) {
				return { mark, start: mark.startWord, end: mark.endWord };
			}
		}
		// A quote made with citations, searched in stripped text, is stripped the same way first.
		const quote =
			mark.prep === "plain" && prep === "noCitations"
				? stripCitations(mark.quote)
				: mark.quote;
		const start = findQuote(norm, normalizedWords(quote), mark.startWord);
		if (start === null) return { mark, start: null, end: null };
		const [, end] = sentenceBounds(tokens, start);
		return { mark, start, end };
	});
}

/** Start index of `needle` (normalized words, empty words skipped) in `hay`, closest to `near`; null if absent. */
function findQuote(
	hay: string[],
	needle: string[],
	near: number,
): number | null {
	if (needle.length === 0) return null;
	let best: number | null = null;
	for (let i = 0; i < hay.length; i++) {
		if (hay[i] !== needle[0]) continue;
		let h = i;
		let n = 0;
		let skipped = 0;
		while (h < hay.length && n < needle.length) {
			if (!hay[h]) {
				h++;
				continue;
			}
			if (hay[h] !== needle[n]) {
				// Tolerate a few extra words in the text, such as citations the quote lacks.
				if (++skipped > MAX_SKIPPED_WORDS) break;
				h++;
				continue;
			}
			h++;
			n++;
		}
		if (
			n === needle.length &&
			(best === null || Math.abs(i - near) < Math.abs(best - near))
		) {
			best = i;
		}
	}
	return best;
}

/** The resolved mark covering word `index`, if any. */
export function markAt(
	resolved: ResolvedMark[],
	index: number,
): ResolvedMark | undefined {
	return resolved.find(
		(r) =>
			r.start !== null && r.end !== null && index >= r.start && index <= r.end,
	);
}
