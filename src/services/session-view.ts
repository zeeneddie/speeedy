import type { DocSession, ReadSpan } from "../models/types.js";
import { computePageStarts, pageForWord } from "./page-map.js";
import { citationWordSpans, coverage, mergeSpans } from "./reading-progress.js";
import { tokenize } from "./rsvp-engine.js";

/**
 * What the progress bar and the library need to show the sessions of a document.
 *
 * Numbering: spans are stored in plain word numbers (`tokenize(text)`, citation
 * filter off) and `totalWords` is `tokenize(text).length`. The reader's own bar
 * runs on the stream it plays; with the citation filter on, pass the map from
 * `buildWordMap` so the pieces line up with that bar.
 */

/** One drawn block of the bar: a merged stretch of one session. */
export interface SessionPiece {
	/** 1-based, in chronological order of `startedAt`. */
	sessionIndex: number;
	/** Alternates per session so neighbouring sessions can be told apart. */
	tint: 0 | 1;
	/** Left edge as a share of the bar (0–1). */
	startFrac: number;
	/** Right edge as a share of the bar (0–1), exclusive: width = endFrac - startFrac. */
	endFrac: number;
}

/** Sessions sorted by start time; empty for documents without sessions. */
export function chronological(sessions?: DocSession[]): DocSession[] {
	return [...(sessions ?? [])].sort((a, b) =>
		a.startedAt.localeCompare(b.startedAt),
	);
}

/** Filtered index of plain word boundary `plain`: the number of filtered words before it. */
function filteredBoundary(map: Int32Array, plain: number): number {
	for (let i = 0; i < map.length; i++) {
		if (map[i] >= plain) return i;
	}
	return map.length;
}

/**
 * Blocks to draw for each session, in session order (later sessions on top).
 * Without `wordMap` the fractions are over the `totalWords` plain words; with
 * it (citation filter on) over the filtered stream, as the reader's bar is.
 * Stretches that fall entirely inside removed citations are left out.
 */
export function sessionPieces(
	sessions: DocSession[] | undefined,
	totalWords: number,
	wordMap?: Int32Array,
): SessionPiece[] {
	if (totalWords <= 0) return [];
	const barTotal = wordMap ? wordMap.length : totalWords;
	if (barTotal <= 0) return [];
	const toBar = (plain: number) =>
		wordMap ? filteredBoundary(wordMap, plain) : plain;
	const pieces: SessionPiece[] = [];
	chronological(sessions).forEach((session, i) => {
		const spans = mergeSpans(
			session.spans
				.map((s) => ({
					start: Math.max(0, s.start),
					end: Math.min(totalWords - 1, s.end),
				}))
				.filter((s) => s.start <= s.end),
		);
		for (const span of spans) {
			const start = toBar(span.start);
			const end = toBar(span.end + 1);
			if (end <= start) continue;
			pieces.push({
				sessionIndex: i + 1,
				tint: (i % 2) as 0 | 1,
				startFrac: start / barTotal,
				endFrac: end / barTotal,
			});
		}
	});
	return pieces;
}

/** Hover data for one session. */
export interface SessionInfo {
	sessionIndex: number;
	startedAt: string;
	/** 1-based pages of the first and last word read; null when the document has no page mapping. */
	startPage: number | null;
	endPage: number | null;
	/** Active reading time, rounded, at least 1. */
	minutes: number;
	wpm: number;
}

/**
 * Hover data per session, in the same order and numbering as {@link sessionPieces}.
 * `pageStarts` must be in plain numbering: `computePageStarts(doc.pages, doc.text)`
 * without the citation filter (the reader's own page starts follow the filter).
 */
export function sessionInfos(
	sessions: DocSession[] | undefined,
	pageStarts: number[] | null,
): SessionInfo[] {
	return chronological(sessions).map((session, i) => {
		let startPage: number | null = null;
		let endPage: number | null = null;
		if (pageStarts && pageStarts.length > 0 && session.spans.length > 0) {
			const first = Math.min(...session.spans.map((s) => s.start));
			const last = Math.max(...session.spans.map((s) => s.end));
			startPage = pageForWord(pageStarts, first) + 1;
			endPage = pageForWord(pageStarts, last) + 1;
		}
		return {
			sessionIndex: i + 1,
			startedAt: session.startedAt,
			startPage,
			endPage,
			minutes: Math.max(1, Math.round(session.durationMs / 60_000)),
			wpm: session.wpm,
		};
	});
}

/**
 * Tooltip line, e.g. "Session 3 · 18 Nov 2026, 14:05 · p. 41 → p. 57 · 22 min · 310 wpm".
 * The date follows the browser locale like the rest of the app; `locale` and
 * `timeZone` are there for tests.
 */
export function formatSessionInfo(
	info: SessionInfo,
	locale?: string,
	timeZone?: string,
): string {
	const date = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
	}).format(new Date(info.startedAt));
	const parts = [`Session ${info.sessionIndex}`, date];
	if (info.startPage !== null && info.endPage !== null) {
		parts.push(
			info.startPage === info.endPage
				? `p. ${info.startPage}`
				: `p. ${info.startPage} → p. ${info.endPage}`,
		);
	}
	parts.push(`${info.minutes} min`, `${info.wpm} wpm`);
	return parts.join(" · ");
}

export interface ReadingSummary {
	fullyRead: boolean;
	sessionCount: number;
	/** Share of the document read, as {@link coverage} reports it (0–1). */
	readRatio: number;
	/**
	 * Plain index of the first unread word (start of the first gap larger than
	 * the tolerance); null when fully read or the document is empty. To jump
	 * there with the citation filter on, convert with `toFilteredIndex(map, i)`.
	 */
	firstUnreadWord: number | null;
}

/**
 * Library summary of a document of `totalWords` plain words (`tokenize(text).length`).
 * `unshown`: plain words the reader never shows (removed citations), counted as read.
 */
export function readingSummary(
	sessions: DocSession[] | undefined,
	totalWords: number,
	unshown?: ReadSpan[],
): ReadingSummary {
	const list = sessions ?? [];
	const cov = coverage(list, totalWords, unshown);
	return {
		fullyRead: cov.fullyRead,
		sessionCount: list.length,
		readRatio: cov.ratio,
		firstUnreadWord:
			cov.fullyRead || totalWords <= 0 ? null : (cov.gaps[0]?.start ?? 0),
	};
}

/** Everything the reader's bar and the library show of a document's sessions. */
export interface SessionView {
	pieces: SessionPiece[];
	/** Tooltip line per session, indexed by `sessionIndex - 1`. */
	lines: string[];
	summary: ReadingSummary;
}

/**
 * Pieces, tooltip lines and summary of the sessions of a stored document
 * (`text` and `pages` as saved, plain). With `removeCitations` the words of
 * removed citations count as read, since the reader never shows them; with
 * `wordMap` (from `buildWordMap`) the pieces follow the filtered stream, as the
 * reader's bar does.
 */
export function sessionView(
	text: string,
	pages: string[] | null | undefined,
	sessions: DocSession[] | undefined,
	opts: { removeCitations?: boolean; wordMap?: Int32Array } = {},
): SessionView {
	const totalWords = tokenize(text).length;
	const pageStarts = pages ? computePageStarts(pages, text) : null;
	return {
		pieces: sessionPieces(sessions, totalWords, opts.wordMap),
		lines: sessionInfos(sessions, pageStarts).map((info) =>
			formatSessionInfo(info),
		),
		summary: readingSummary(
			sessions,
			totalWords,
			opts.removeCitations ? citationWordSpans(text, totalWords) : undefined,
		),
	};
}
