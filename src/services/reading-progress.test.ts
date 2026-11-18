import { describe, expect, it } from "vitest";
import type { DocSession } from "../models/types.js";
import { stripCitations } from "../utils/text-utils.js";
import {
	buildWordMap,
	coverage,
	coverageOf,
	mergeSpans,
	SessionRecorder,
	toFilteredIndex,
	toPlainIndex,
} from "./reading-progress.js";
import { tokenize } from "./rsvp-engine.js";

const session = (spans: [number, number][]): DocSession => ({
	id: "s",
	startedAt: "2026-11-18T10:00:00.000Z",
	endedAt: "2026-11-18T10:10:00.000Z",
	durationMs: 600_000,
	wordsRead: 0,
	wpm: 0,
	spans: spans.map(([start, end]) => ({ start, end })),
});

describe("buildWordMap", () => {
	it("maps words of the citation-free text back to the plain text", () => {
		const text = "One two [1] three four (Smith et al., 2020) five.";
		const plain = tokenize(text).map((t) => t.text);
		const filtered = tokenize(stripCitations(text)).map((t) => t.text);
		const map = buildWordMap(text, filtered);
		filtered.forEach((word, i) => {
			expect(plain[map[i]]?.replace(/[^\p{L}]/gu, "")).toBe(
				word.replace(/[^\p{L}]/gu, ""),
			);
		});
		expect(toFilteredIndex(map, toPlainIndex(map, 3))).toBe(3);
	});

	// Unique text words, so a word can only map to its own position.
	const words = (from: number, count: number) =>
		Array.from({ length: count }, (_, i) => `word${from + i}`).join(" ");
	// One parenthetical with 20 author-year citations: 80 tokens, all removed.
	const longCitation = `(${Array.from(
		{ length: 20 },
		(_, i) => `Author${String.fromCharCode(65 + i)} et al., 20${10 + i}`,
	).join("; ")})`;
	const streams = (text: string) => {
		const plain = tokenize(text).map((t) => t.text);
		const filtered = tokenize(stripCitations(text)).map((t) => t.text);
		return { plain, filtered, map: buildWordMap(text, filtered) };
	};
	const norm = (w: string | undefined) =>
		(w ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
	const expectExact = ({
		plain,
		filtered,
		map,
	}: ReturnType<typeof streams>) => {
		filtered.forEach((word, i) => {
			expect(map[i], `filtered word ${i} (${word})`).toBeGreaterThanOrEqual(0);
			expect(norm(plain[map[i]])).toBe(norm(word));
		});
	};

	it("keeps mapping after a removed citation of more than 60 words", () => {
		const s = streams(`${words(0, 5)} ${longCitation} ${words(5, 200)}.`);
		expect(s.plain.length - s.filtered.length).toBeGreaterThan(60);
		expectExact(s);
	});

	it("round-trips plain → filtered → plain for every kept word", () => {
		const s = streams(
			`${words(0, 30)} ${longCitation} ${words(30, 100)} [1, 2] ${words(130, 50)}.`,
		);
		const kept = new Set(s.map);
		for (let p = 0; p < s.plain.length; p++) {
			if (!kept.has(p)) continue;
			expect(toPlainIndex(s.map, toFilteredIndex(s.map, p)), `plain ${p}`).toBe(
				p,
			);
		}
		for (let i = 0; i < s.filtered.length; i++) {
			expect(toFilteredIndex(s.map, toPlainIndex(s.map, i))).toBe(i);
		}
		expect(kept.size).toBe(s.filtered.length);
	});

	it("maps a repeated word to the one that was read, not to the one in the citation", () => {
		expect(Array.from(streams("Intro (Smith et al., 2020) Smith").map)).toEqual(
			[0, 5],
		);
	});

	it("keeps the repeated word in place when a removal also glues two words", () => {
		// Removing [1] glues foo and bar, so the counts differ and the forward
		// match runs; it must still skip the Smith inside the citation.
		const s = streams("Intro (Smith et al., 2020) Smith foo[1]bar");
		expect(s.filtered).toEqual(["Intro", "Smith", "foobar"]);
		expect(s.map[1]).toBe(5);
	});

	it("maps a word used before, inside and after a citation to its own place", () => {
		const s = streams("growth then (Growth, 2020) growth then [1] growth.");
		expect(s.filtered).toEqual(["growth", "then", "growth", "then", "growth."]);
		expect(Array.from(s.map)).toEqual([0, 1, 4, 5, 7]);
	});

	it("keeps mapping across several long citations in a row", () => {
		const s = streams(
			`${words(0, 10)} ${longCitation} ${longCitation} ${words(10, 3)} ${longCitation} ${words(13, 100)}.`,
		);
		expect(s.plain.length - s.filtered.length).toBeGreaterThan(180);
		expectExact(s);
	});
});

describe("mergeSpans", () => {
	it("merges overlapping and touching spans, optionally across small gaps", () => {
		const spans = [
			{ start: 10, end: 20 },
			{ start: 0, end: 5 },
			{ start: 21, end: 25 },
			{ start: 30, end: 31 },
		];
		expect(mergeSpans(spans)).toEqual([
			{ start: 0, end: 5 },
			{ start: 10, end: 25 },
			{ start: 30, end: 31 },
		]);
		expect(mergeSpans(spans, 5)).toEqual([{ start: 0, end: 31 }]);
	});
});

describe("coverage", () => {
	it("counts a document as fully read when gaps are at most 5 words", () => {
		const result = coverage(
			[
				session([
					[0, 499],
					[505, 999],
				]),
			],
			1000,
		);
		expect(result.fullyRead).toBe(true);
		expect(result.gaps).toEqual([]);
		expect(result.wordsRead).toBe(995);
	});

	it("shows a gap of 6 words or more as skipped", () => {
		const result = coverage(
			[
				session([
					[0, 499],
					[506, 999],
				]),
			],
			1000,
		);
		expect(result.gaps).toEqual([{ start: 500, end: 505 }]);
		expect(result.ratio).toBeCloseTo(0.994, 3);
		expect(result.fullyRead).toBe(true);
	});

	it("is not fully read below 99%", () => {
		const result = coverage([session([[0, 979]])], 1000);
		expect(result.fullyRead).toBe(false);
		expect(result.gaps).toEqual([{ start: 980, end: 999 }]);
	});

	it("does not count spans beyond the document", () => {
		const result = coverage([session([[0, 1500]])], 1000);
		expect(result.wordsRead).toBe(1000);
		expect(result.fullyRead).toBe(true);
	});

	it("combines sessions", () => {
		const result = coverage([session([[0, 499]]), session([[500, 999]])], 1000);
		expect(result.fullyRead).toBe(true);
	});

	it("measures the read share of one part", () => {
		expect(
			coverageOf(
				[
					session([
						[0, 49],
						[100, 149],
					]),
				],
				0,
				99,
			),
		).toBe(0.5);
	});
});

describe("SessionRecorder", () => {
	it("keeps contiguous words in one stretch and splits at a jump", () => {
		const rec = new SessionRecorder();
		for (let i = 0; i < 20; i++) rec.onWords(i, 1, (i + 1) * 300);
		for (let i = 200; i < 220; i += 2)
			rec.onWords(i, 2, 6000 + (i - 199) * 300);
		const s = rec.finish();
		expect(s?.spans).toEqual([
			{ start: 0, end: 19 },
			{ start: 200, end: 219 },
		]);
		expect(s?.wordsRead).toBe(40);
	});

	it("does not count pause time as reading time", () => {
		const rec = new SessionRecorder();
		for (let i = 0; i < 20; i++) rec.onWords(i, 1, (i + 1) * 500);
		rec.pause(10_000);
		// One minute paused, then reading continues with the next word.
		for (let i = 20; i < 40; i++) rec.onWords(i, 1, 70_000 + (i - 19) * 500);
		const s = rec.finish();
		expect(s?.durationMs).toBe(19 * 500 + 19 * 500);
		expect(s?.spans).toEqual([{ start: 0, end: 39 }]);
	});

	it("discards a session that is too short", () => {
		const rec = new SessionRecorder();
		for (let i = 0; i < 5; i++) rec.onWords(i, 1, i * 200);
		expect(rec.finish()).toBeNull();
	});

	it("keeps a short session that reaches the end of the document", () => {
		// 40 words at 600 wpm: 3.9 s, below the minimum, but the whole text.
		const rec = new SessionRecorder();
		for (let i = 0; i < 40; i++) rec.onWords(i, 1, i * 100);
		const s = rec.finish(undefined, 39);
		expect(s?.spans).toEqual([{ start: 0, end: 39 }]);
	});

	it("gives no wpm for a text shown in a single chunk", () => {
		const rec = new SessionRecorder();
		rec.onWords(0, 3, 1000);
		expect(rec.finish(undefined, 2)?.wpm).toBe(0);
	});

	it("still discards a short session that does not reach the end", () => {
		const rec = new SessionRecorder();
		for (let i = 0; i < 5; i++) rec.onWords(i, 1, i * 200);
		expect(rec.finish(undefined, 39)).toBeNull();
	});

	it("counts the words shown, not the plain span they cover", () => {
		// 8 words in 7 s; the citation filter removed 12 words between the 4th and 5th.
		const rec = new SessionRecorder();
		for (let i = 0; i < 8; i++) rec.onWords(i, 1, i * 1000);
		expect(rec.finish((i) => (i < 4 ? i : i + 12))).toBeNull();
	});

	it("counts rereading as words read", () => {
		// The same five words read four times: 20 words in 7.6 s.
		const rec = new SessionRecorder();
		for (let round = 0; round < 4; round++)
			for (let i = 0; i < 5; i++) rec.onWords(i, 1, (round * 5 + i + 1) * 400);
		const s = rec.finish();
		expect(s?.wordsRead).toBe(20);
		expect(s?.spans).toEqual([{ start: 0, end: 4 }]);
		expect(s?.wpm).toBe(Math.round((20 / 7600) * 60_000));
	});

	it("counts the time of the last chunk up to the pause", () => {
		// Ten words, the last at 4.5 s, paused at 5.2 s.
		const rec = new SessionRecorder();
		for (let i = 0; i < 10; i++) rec.onWords(i, 1, i * 500);
		rec.pause(5200);
		expect(rec.finish()?.durationMs).toBe(5200);
	});

	it("ends the session at the pause that closed the last word", () => {
		// Ten words up to 4.5 s, paused at 5.2 s: the active time ends at the pause.
		const rec = new SessionRecorder();
		for (let i = 0; i < 10; i++) rec.onWords(i, 1, i * 500);
		rec.pause(5200);
		const s = rec.finish();
		expect(s?.endedAt).toBe(new Date(5200).toISOString());
		expect(s?.startedAt).toBe(new Date(0).toISOString());
	});

	it("does not move the session end to a pause after a long gap", () => {
		// The gap to the pause is longer than a word may take: not counted.
		const rec = new SessionRecorder();
		for (let i = 0; i < 20; i++) rec.onWords(i, 1, i * 500);
		rec.pause(9500 + 60_000);
		expect(rec.finish()?.endedAt).toBe(new Date(9500).toISOString());
	});

	it("discards a session paused just before 5 s", () => {
		const rec = new SessionRecorder();
		for (let i = 0; i < 10; i++) rec.onWords(i, 1, i * 500);
		rec.pause(4999);
		expect(rec.finish()).toBeNull();
	});

	it("counts the time of the last chunk up to the end of the session", () => {
		// Completion or leaving while still playing: no pause() before finish().
		const rec = new SessionRecorder();
		for (let i = 0; i < 10; i++) rec.onWords(i, 1, i * 500);
		expect(rec.finish(undefined, undefined, 5000)?.durationMs).toBe(5000);
	});

	it("converts word indices with the given mapping", () => {
		const rec = new SessionRecorder();
		for (let i = 0; i < 30; i++) rec.onWords(i, 1, (i + 1) * 300);
		expect(rec.finish((i) => i + 100)?.spans).toEqual([
			{ start: 100, end: 129 },
		]);
	});
});
