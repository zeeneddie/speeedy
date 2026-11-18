import { describe, expect, it } from "vitest";
import {
	alignTokensToItems,
	normalizeForMatch,
	type PdfTextItem,
	tokenAtPoint,
	toPdfTextItem,
} from "./pdf-word-geometry.js";

// One char = 10 units wide, so x positions are easy to read.
const item = (str: string, x: number, y: number): PdfTextItem => ({
	str,
	x,
	y,
	w: [...str].length * 10,
	h: 10,
});

describe("normalizeForMatch", () => {
	it("keeps letters and digits, lowercased, without accents or punctuation", () => {
		expect(normalizeForMatch("Café,")).toBe("cafe");
		expect(normalizeForMatch("here[")).toBe("here");
		expect(normalizeForMatch("1]")).toBe("1");
		expect(normalizeForMatch("—")).toBe("");
	});

	it("decomposes ligatures", () => {
		expect(normalizeForMatch("ﬁnd")).toBe("find");
	});
});

describe("toPdfTextItem", () => {
	it("takes position from the transform and falls back to the font scale for height", () => {
		expect(
			toPdfTextItem({
				str: "Hi",
				transform: [12, 0, 0, 12, 50, 700],
				width: 14,
				height: 0,
			}),
		).toEqual({ str: "Hi", x: 50, y: 700, w: 14, h: 12 });
	});
});

describe("alignTokensToItems", () => {
	it("places each word on its own part of the line", () => {
		const rects = alignTokensToItems(
			["The", "quick", "fox."],
			[item("The quick fox.", 100, 500)],
		);
		expect(rects[0]?.[0]).toMatchObject({ x0: 100, x1: 130 });
		expect(rects[1]?.[0]).toMatchObject({ x0: 140, x1: 190 });
		expect(rects[2]?.[0]).toMatchObject({ x0: 200, x1: 230 });
	});

	it("follows words across items and lines", () => {
		const rects = alignTokensToItems(
			["end", "of", "line", "next"],
			[item("end of", 0, 500), item("line", 70, 500), item("next", 0, 480)],
		);
		expect(rects.map((r) => r?.[0].y0)).toEqual([498, 498, 498, 478]);
		expect(rects[2]?.[0].x0).toBe(70);
	});

	it("splits a word broken over two items into two rectangles", () => {
		const rects = alignTokensToItems(
			["speedreading"],
			[item("speed", 0, 500), item("reading", 50, 500)],
		);
		expect(rects[0]).toHaveLength(2);
	});

	it("joins words the reader split differently, such as citations", () => {
		const rects = alignTokensToItems(
			["here[", "1]", "and"],
			[item("here [1] and", 0, 500)],
		);
		expect(rects.every((r) => r !== null)).toBe(true);
	});

	it("leaves a word it cannot find as null and carries on with the next", () => {
		const rects = alignTokensToItems(
			["alpha", "missing", "beta"],
			[item("alpha beta", 0, 500)],
		);
		expect(rects[0]).not.toBeNull();
		expect(rects[1]).toBeNull();
		expect(rects[2]).not.toBeNull();
	});

	it("does not jump far ahead to match a repeated word", () => {
		const filler = "x".repeat(1000);
		const rects = alignTokensToItems(
			["start", "target"],
			[item("start", 0, 500), item(filler, 0, 480), item("target", 0, 460)],
		);
		expect(rects[1]).toBeNull();
	});

	it("gives punctuation-only tokens no rectangle", () => {
		expect(alignTokensToItems(["—"], [item("a — b", 0, 500)])).toEqual([null]);
	});
});

describe("tokenAtPoint", () => {
	const rects = alignTokensToItems(["one", "two"], [item("one two", 0, 500)]);

	it("finds the word under the point", () => {
		expect(tokenAtPoint(rects, 45, 503)).toBe(1);
		expect(tokenAtPoint(rects, 5, 503)).toBe(0);
	});

	it("picks the nearest word just outside the text", () => {
		expect(tokenAtPoint(rects, 75, 503)).toBe(1);
	});

	it("returns -1 far away from any word", () => {
		expect(tokenAtPoint(rects, 500, 100)).toBe(-1);
	});
});
