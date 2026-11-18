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
		const map = buildWordMap(plain, filtered);
		filtered.forEach((word, i) => {
			expect(plain[map[i]]?.replace(/[^\p{L}]/gu, "")).toBe(
				word.replace(/[^\p{L}]/gu, ""),
			);
		});
		expect(toFilteredIndex(map, toPlainIndex(map, 3))).toBe(3);
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
		rec.pause();
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

	it("converts word indices with the given mapping", () => {
		const rec = new SessionRecorder();
		for (let i = 0; i < 30; i++) rec.onWords(i, 1, (i + 1) * 300);
		expect(rec.finish((i) => i + 100)?.spans).toEqual([
			{ start: 100, end: 129 },
		]);
	});
});
