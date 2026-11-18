import { describe, expect, it } from "vitest";
import type { DocSession } from "../models/types.js";
import { stripCitations } from "../utils/text-utils.js";
import {
	buildWordMap,
	FULLY_READ_RATIO,
	GAP_TOLERANCE_WORDS,
} from "./reading-progress.js";
import { tokenize } from "./rsvp-engine.js";
import {
	formatSessionInfo,
	readingSummary,
	sessionInfos,
	sessionPieces,
	sessionView,
} from "./session-view.js";

const session = (
	spans: [number, number][],
	startedAt = "2026-11-18T10:00:00.000Z",
	extra: Partial<DocSession> = {},
): DocSession => ({
	id: startedAt,
	startedAt,
	endedAt: startedAt,
	durationMs: 600_000,
	wordsRead: 0,
	wpm: 300,
	spans: spans.map(([start, end]) => ({ start, end })),
	...extra,
});

describe("sessionPieces", () => {
	it("places two sessions on their fractions with alternating tint, in chronological order", () => {
		// Stored out of order: the later session first.
		const sessions = [
			session([[500, 749]], "2026-11-18T12:00:00.000Z"),
			session([[0, 249]], "2026-11-17T09:00:00.000Z"),
		];
		expect(sessionPieces(sessions, 1000)).toEqual([
			{ sessionIndex: 1, tint: 0, startFrac: 0, endFrac: 0.25 },
			{ sessionIndex: 2, tint: 1, startFrac: 0.5, endFrac: 0.75 },
		]);
	});

	it("gives one piece per stretch of a session, and the third session the first tint again", () => {
		const sessions = [
			session([[0, 99]], "2026-11-01T00:00:00.000Z"),
			session([[100, 199]], "2026-11-02T00:00:00.000Z"),
			session(
				[
					[300, 399],
					[600, 699],
				],
				"2026-11-03T00:00:00.000Z",
			),
		];
		const pieces = sessionPieces(sessions, 1000);
		expect(pieces.map((p) => [p.sessionIndex, p.tint])).toEqual([
			[1, 0],
			[2, 1],
			[3, 0],
			[3, 0],
		]);
		expect(pieces[2]).toMatchObject({ startFrac: 0.3, endFrac: 0.4 });
		expect(pieces[3]).toMatchObject({ startFrac: 0.6, endFrac: 0.7 });
	});

	it("leaves skipped text empty and clamps spans to the document", () => {
		const pieces = sessionPieces(
			[
				session([
					[-5, 99],
					[900, 1200],
				]),
			],
			1000,
		);
		expect(pieces.map((p) => [p.startFrac, p.endFrac])).toEqual([
			[0, 0.1],
			[0.9, 1],
		]);
		// Nothing covers 0.1–0.9.
		expect(pieces.some((p) => p.startFrac < 0.9 && p.endFrac > 0.1)).toBe(
			false,
		);
	});

	it("returns nothing for documents without sessions or words", () => {
		expect(sessionPieces(undefined, 1000)).toEqual([]);
		expect(sessionPieces([], 1000)).toEqual([]);
		expect(sessionPieces([session([[0, 9]])], 0)).toEqual([]);
	});

	it("lines up with the filtered stream when the citation filter is on", () => {
		// Plain: 0 One 1 two 2 [1] 3 three 4 four; filtered: One two three four.
		const text = "One two [1] three four";
		const filtered = tokenize(stripCitations(text)).map((t) => t.text);
		const plainTotal = tokenize(text).length;
		const map = buildWordMap(text, filtered);
		expect(filtered.length).toBe(4);
		expect(plainTotal).toBe(5);
		// Read "three four" (plain 3–4) = filtered 2–3 = right half of the filtered bar.
		const pieces = sessionPieces([session([[3, 4]])], plainTotal, map);
		expect(pieces).toEqual([
			{ sessionIndex: 1, tint: 0, startFrac: 0.5, endFrac: 1 },
		]);
		// Without the map the same span is plain 3/5 – 5/5.
		expect(sessionPieces([session([[3, 4]])], plainTotal)[0]).toMatchObject({
			startFrac: 0.6,
			endFrac: 1,
		});
	});

	it("drops a stretch that lies entirely inside a removed citation", () => {
		const text = "One two [1] three four";
		const filtered = tokenize(stripCitations(text)).map((t) => t.text);
		const map = buildWordMap(text, filtered);
		expect(sessionPieces([session([[2, 2]])], 5, map)).toEqual([]);
	});
});

describe("sessionInfos and formatSessionInfo", () => {
	const s = session(
		[
			[410, 500],
			[520, 560],
		],
		"2026-11-18T14:05:00.000Z",
		{ durationMs: 22 * 60_000 + 10_000, wpm: 310 },
	);

	it("gives the page of the first and last word read (1-based)", () => {
		// Ten words per page: word 410 is on page 42, word 560 on page 57.
		const pageStarts = Array.from({ length: 100 }, (_, i) => i * 10);
		const [info] = sessionInfos([s], pageStarts);
		expect(info).toEqual({
			sessionIndex: 1,
			startedAt: "2026-11-18T14:05:00.000Z",
			startPage: 42,
			endPage: 57,
			minutes: 22,
			wpm: 310,
		});
		expect(
			formatSessionInfo({ ...info, sessionIndex: 3 }, "en-GB", "UTC"),
		).toBe("Session 3 · 18 Nov 2026, 14:05 · p. 42 → p. 57 · 22 min · 310 wpm");
	});

	it("leaves the pages out when the document has none", () => {
		const [info] = sessionInfos([s], null);
		expect(info.startPage).toBeNull();
		expect(info.endPage).toBeNull();
		expect(formatSessionInfo(info, "en-GB", "UTC")).toBe(
			"Session 1 · 18 Nov 2026, 14:05 · 22 min · 310 wpm",
		);
	});

	it("shows one page when the session stays on it, and at least 1 minute", () => {
		const short = session([[3, 8]], "2026-11-18T14:05:00.000Z", {
			durationMs: 6_000,
			wpm: 250,
		});
		const [info] = sessionInfos([short], [0, 10, 20]);
		expect(formatSessionInfo(info, "en-GB", "UTC")).toBe(
			"Session 1 · 18 Nov 2026, 14:05 · p. 1 · 1 min · 250 wpm",
		);
	});

	it("numbers sessions as the pieces do", () => {
		const infos = sessionInfos(
			[
				session([[0, 9]], "2026-11-18T12:00:00.000Z"),
				session([[0, 9]], "2026-11-17T12:00:00.000Z"),
			],
			null,
		);
		expect(infos.map((i) => [i.sessionIndex, i.startedAt])).toEqual([
			[1, "2026-11-17T12:00:00.000Z"],
			[2, "2026-11-18T12:00:00.000Z"],
		]);
	});

	it("returns nothing without sessions", () => {
		expect(sessionInfos(undefined, null)).toEqual([]);
	});
});

describe("readingSummary", () => {
	it("is fully read just at the threshold, not just below it", () => {
		// 1000 words, threshold 99% = at most 10 words unread in gaps larger than the tolerance.
		expect(FULLY_READ_RATIO).toBe(0.99);
		const atThreshold = readingSummary([session([[0, 989]])], 1000);
		expect(atThreshold).toEqual({
			fullyRead: true,
			sessionCount: 1,
			readRatio: 0.99,
			firstUnreadWord: null,
		});
		const below = readingSummary([session([[0, 988]])], 1000);
		expect(below).toEqual({
			fullyRead: false,
			sessionCount: 1,
			readRatio: 0.989,
			firstUnreadWord: 989,
		});
	});

	it("finds the first unread word at the start, in the middle, and ignores small gaps", () => {
		expect(readingSummary([session([[200, 999]])], 1000).firstUnreadWord).toBe(
			0,
		);
		// A gap of exactly the tolerance is closed; the next one (6 words) is not.
		const middle = readingSummary(
			[
				session([[0, 99]], "2026-11-01T00:00:00.000Z"),
				session([[100 + GAP_TOLERANCE_WORDS, 299]], "2026-11-02T00:00:00.000Z"),
				session([[306, 399]], "2026-11-03T00:00:00.000Z"),
			],
			400,
		);
		expect(middle.sessionCount).toBe(3);
		expect(middle.firstUnreadWord).toBe(300);
	});

	it("handles documents without sessions and old documents without the field", () => {
		expect(readingSummary(undefined, 1000)).toEqual({
			fullyRead: false,
			sessionCount: 0,
			readRatio: 0,
			firstUnreadWord: 0,
		});
		expect(readingSummary([], 3)).toEqual({
			fullyRead: false,
			sessionCount: 0,
			readRatio: 0,
			firstUnreadWord: 0,
		});
		expect(readingSummary([], 0)).toEqual({
			fullyRead: false,
			sessionCount: 0,
			readRatio: 0,
			firstUnreadWord: null,
		});
	});
});

describe("sessionView", () => {
	const words = (n: number, prefix = "w") =>
		Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

	it("counts a removed citation at the end as read with the filter on, not with it off", () => {
		// 300 words ending in a citation of 7 words: plain 307, filtered 300.
		const text = `${words(300)} [1, 2, 3, 4, 5, 6, 7].`;
		expect(tokenize(text)).toHaveLength(307);
		expect(tokenize(stripCitations(text))).toHaveLength(300);
		// Read to the end with the filter on: the last filtered word is plain 299.
		const sessions = [session([[0, 299]])];
		expect(
			sessionView(text, null, sessions, { removeCitations: true }).summary,
		).toEqual({
			fullyRead: true,
			sessionCount: 1,
			readRatio: 1,
			firstUnreadWord: null,
		});
		expect(sessionView(text, null, sessions).summary).toEqual({
			fullyRead: false,
			sessionCount: 1,
			readRatio: 300 / 307,
			firstUnreadWord: 300,
		});
	});

	it("does not send the reader back into a removed citation between two read stretches", () => {
		// a0..a99, a citation of 6 plain words, b0..b99: plain 206.
		const text = `${words(100, "a")} [1, 2, 3, 4, 5, 6] ${words(100, "b")}`;
		expect(tokenize(text)).toHaveLength(206);
		const sessions = [
			session([[0, 99]], "2026-11-01T00:00:00.000Z"),
			session([[106, 205]], "2026-11-02T00:00:00.000Z"),
		];
		expect(
			sessionView(text, null, sessions, { removeCitations: true }).summary
				.fullyRead,
		).toBe(true);
		// Unread text after the citation is still found.
		const partial = sessionView(text, null, [session([[0, 99]])], {
			removeCitations: true,
		});
		expect(partial.summary.firstUnreadWord).toBe(106);
	});

	it("gives the same pieces and lines as the separate functions", () => {
		const text = words(100);
		const pages = [words(50), words(50)];
		const sessions = [session([[0, 79]])];
		const view = sessionView(text, pages, sessions);
		expect(view.pieces).toEqual(sessionPieces(sessions, 100));
		expect(view.lines).toHaveLength(1);
		expect(view.lines[0]).toContain("p. 1 → p. 2");
	});
});
