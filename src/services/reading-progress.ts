import type { DocSession, ReadSpan } from "../models/types.js";
import { citationRanges } from "../utils/text-utils.js";
import { normalizeForMatch } from "./pdf-word-geometry.js";
import { tokenize, wordStarts } from "./rsvp-engine.js";

/** Gaps of at most this many words between read stretches count as read. */
export const GAP_TOLERANCE_WORDS = 5;
/** Share of the words that must be covered (after closing small gaps) to count as fully read. */
export const FULLY_READ_RATIO = 0.99;

/**
 * Maps each word of the citation-free stream (`tokenize(stripCitations(text))`)
 * to the index of the same word in the plain stream (`tokenize(text)`).
 * Exact: a plain word is dropped when it starts inside a range that
 * stripCitations removes, and the kept plain words pair up in order with the
 * filtered ones. When the counts do not line up (a removal glued two words
 * together, or the segmentation differs) it falls back to matching words
 * forward; a word that is not found there stays -1.
 */
export function buildWordMap(text: string, filtered: string[]): Int32Array {
	const plain = tokenize(text).map((t) => t.text);
	const starts = wordStarts(text);
	if (starts.length === plain.length) {
		const ranges = citationRanges(text);
		const kept: number[] = [];
		let r = 0;
		starts.forEach((start, j) => {
			while (r < ranges.length && ranges[r][1] <= start) r++;
			if (r < ranges.length && ranges[r][0] <= start) return;
			kept.push(j);
		});
		if (kept.length === filtered.length) return Int32Array.from(kept);
	}
	return matchForward(plain, filtered);
}

/** Matches each filtered word to the next equal plain word (normalized); -1 when not found. */
function matchForward(plain: string[], filtered: string[]): Int32Array {
	const plainNorm = plain.map(normalizeForMatch);
	const map = new Int32Array(filtered.length).fill(-1);
	let cursor = 0;
	for (let i = 0; i < filtered.length; i++) {
		const word = normalizeForMatch(filtered[i]);
		if (!word) continue;
		for (let j = cursor; j < plain.length; j++) {
			if (plainNorm[j] === word) {
				map[i] = j;
				cursor = j + 1;
				break;
			}
		}
	}
	return map;
}

/** Plain index for a filtered index, using the nearest mapped neighbour when the word itself was not placed. */
export function toPlainIndex(map: Int32Array, filteredIndex: number): number {
	if (map.length === 0) return filteredIndex;
	const at = Math.min(Math.max(filteredIndex, 0), map.length - 1);
	for (let d = 0; d < map.length; d++) {
		if (at - d >= 0 && map[at - d] >= 0) return map[at - d] + d;
		if (at + d < map.length && map[at + d] >= 0)
			return Math.max(0, map[at + d] - d);
	}
	return filteredIndex;
}

/** Filtered index for a plain index: the first filtered word at or after it. */
export function toFilteredIndex(map: Int32Array, plainIndex: number): number {
	for (let i = 0; i < map.length; i++) {
		if (map[i] >= plainIndex) return i;
	}
	return Math.max(0, map.length - 1);
}

/** Sorts and merges overlapping or touching spans. */
export function mergeSpans(spans: ReadSpan[], gap = 0): ReadSpan[] {
	const sorted = spans
		.filter((s) => s.end >= s.start)
		.map((s) => ({ ...s }))
		.sort((a, b) => a.start - b.start);
	const merged: ReadSpan[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last && span.start <= last.end + 1 + gap) {
			last.end = Math.max(last.end, span.end);
		} else {
			merged.push(span);
		}
	}
	return merged;
}

export interface Coverage {
	/** Words covered by the union of all sessions (small gaps not closed). */
	wordsRead: number;
	/** Share of the document covered after closing gaps up to {@link GAP_TOLERANCE_WORDS}. */
	ratio: number;
	fullyRead: boolean;
	/** Unread stretches larger than the tolerance, for showing what was skipped. */
	gaps: ReadSpan[];
}

/**
 * What part of a document of `totalWords` (plain) the sessions cover.
 * `totalWords` is `tokenize(text).length` of the plain text — the numbering the
 * spans use — not `countWords`, which counts differently. Spans are clamped to
 * [0, totalWords - 1].
 */
export function coverage(sessions: DocSession[], totalWords: number): Coverage {
	if (totalWords <= 0) {
		return { wordsRead: 0, ratio: 0, fullyRead: false, gaps: [] };
	}
	const spans = sessions.flatMap((s) =>
		s.spans.map((span) => ({
			start: Math.max(0, span.start),
			end: Math.min(totalWords - 1, span.end),
		})),
	);
	const exact = mergeSpans(spans);
	const wordsRead = exact.reduce((n, s) => n + (s.end - s.start + 1), 0);
	const closed = mergeSpans(spans, GAP_TOLERANCE_WORDS);
	// Gaps at the very start or end are measured against the document edges.
	const gaps: ReadSpan[] = [];
	let next = 0;
	for (const span of closed) {
		if (span.start - next > GAP_TOLERANCE_WORDS) {
			gaps.push({ start: next, end: span.start - 1 });
		}
		next = span.end + 1;
	}
	if (totalWords - next > GAP_TOLERANCE_WORDS) {
		gaps.push({ start: next, end: totalWords - 1 });
	}
	const gapWords = gaps.reduce((n, g) => n + (g.end - g.start + 1), 0);
	const ratio = Math.max(0, Math.min(1, (totalWords - gapWords) / totalWords));
	return {
		wordsRead,
		ratio: closed.length ? ratio : 0,
		fullyRead: closed.length > 0 && ratio >= FULLY_READ_RATIO,
		gaps,
	};
}

/** Share of words [from, to] (inclusive, plain) covered by the sessions — e.g. one chapter of the table of contents. */
export function coverageOf(
	sessions: DocSession[],
	from: number,
	to: number,
): number {
	if (to < from) return 0;
	const merged = mergeSpans(sessions.flatMap((s) => s.spans));
	let covered = 0;
	for (const span of merged) {
		const start = Math.max(span.start, from);
		const end = Math.min(span.end, to);
		if (end >= start) covered += end - start + 1;
	}
	return covered / (to - from + 1);
}

/**
 * Sessions shorter than this are discarded (an accidental tap on space), unless
 * they reach the end of the document: a short text read to the end counts.
 */
export const MIN_SESSION_MS = 5000;
export const MIN_SESSION_WORDS = 10;

/** Longest pause between two words that still counts as reading time. */
const MAX_WORD_GAP_MS = 10_000;

/**
 * Records one reading session from the words the reader shows. A stretch ends
 * when the next word shown does not directly follow the previous one (a jump),
 * so skipped text never counts as read.
 */
export class SessionRecorder {
	private spans: ReadSpan[] = [];
	private current: ReadSpan | null = null;
	private startedAt: number | null = null;
	/** Time of the previous word while playing; null after a pause, so the pause is not counted. */
	private lastAt: number | null = null;
	/** Time of the last word shown, for the session end. */
	private lastWordAt: number | null = null;
	private activeMs = 0;
	/** Words shown, rereading included; words the citation filter removed are never shown. */
	private wordsShown = 0;

	/** Call for every chunk shown while playing: first word index and number of words in the chunk. */
	onWords(index: number, count: number, now: number): void {
		if (count <= 0) return;
		const end = index + count - 1;
		if (this.current && index === this.current.end + 1) {
			this.current.end = end;
		} else {
			if (this.current) this.spans.push(this.current);
			this.current = { start: index, end };
		}
		if (this.startedAt === null) this.startedAt = now;
		this.closeActive(now);
		this.lastAt = now;
		this.lastWordAt = now;
		this.wordsShown += count;
	}

	/** Counts the time from the previous word shown up to `now` as reading time. */
	private closeActive(now: number): void {
		if (this.lastAt !== null && now - this.lastAt <= MAX_WORD_GAP_MS) {
			this.activeMs += now - this.lastAt;
		}
	}

	/**
	 * Pause at `now`: the word shown last counts as read up to then. The next
	 * word starts a new stretch unless it directly follows.
	 */
	pause(now: number): void {
		this.closeActive(now);
		this.lastAt = null;
	}

	/**
	 * The session so far, with spans converted by `toPlain`; null when it is too
	 * short to keep and does not reach `lastIndex` (the last word of the stream
	 * played, before conversion). `now` is when the session ends (pause,
	 * completion, leaving); while still playing it closes the time of the word
	 * shown last. Resets the recorder.
	 */
	finish(
		toPlain: (index: number) => number = (i) => i,
		lastIndex = Number.POSITIVE_INFINITY,
		now?: number,
	): DocSession | null {
		if (now !== undefined) this.closeActive(now);
		if (this.current) this.spans.push(this.current);
		const reachedEnd = this.spans.some((s) => s.end >= lastIndex);
		const spans = mergeSpans(
			this.spans.map((s) => ({ start: toPlain(s.start), end: toPlain(s.end) })),
		);
		const wordsRead = this.wordsShown;
		const startedAt = this.startedAt;
		const endedAt = this.lastWordAt ?? Date.now();
		const durationMs = this.activeMs;
		this.reset();
		if (
			startedAt === null ||
			(!reachedEnd &&
				(wordsRead < MIN_SESSION_WORDS || durationMs < MIN_SESSION_MS))
		) {
			return null;
		}
		return {
			id: crypto.randomUUID(),
			startedAt: new Date(startedAt).toISOString(),
			endedAt: new Date(endedAt).toISOString(),
			durationMs,
			wordsRead,
			// A short text shown in one chunk has no measured reading time.
			wpm: durationMs > 0 ? Math.round((wordsRead / durationMs) * 60_000) : 0,
			spans,
		};
	}

	reset(): void {
		this.spans = [];
		this.current = null;
		this.startedAt = null;
		this.lastAt = null;
		this.lastWordAt = null;
		this.activeMs = 0;
		this.wordsShown = 0;
	}
}
