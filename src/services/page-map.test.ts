import { describe, expect, it } from "vitest";
import { stripCitations } from "../utils/text-utils.js";
import { computePageStarts, pageForWord } from "./page-map.js";
import { tokenize } from "./rsvp-engine.js";

const pages = [
	"The first page has six words.",
	"",
	"Page three starts here [1] and\n\nhas a second paragraph.",
	"Last page.",
];
const fullText = pages.join("\n\n").replace(/\n{3,}/g, "\n\n");

describe("computePageStarts", () => {
	it("returns the word index at which each page starts", () => {
		const starts = computePageStarts(pages, fullText);
		expect(starts).toEqual([0, 6, 6, 16]);
		expect(tokenize(fullText)).toHaveLength(18);
	});

	it("keeps blank pages at the start of the next page", () => {
		const starts = computePageStarts(pages, fullText);
		expect(starts?.[1]).toBe(starts?.[2]);
	});

	it("applies the reader's text preparation per page", () => {
		const starts = computePageStarts(pages, fullText, stripCitations);
		expect(starts).toEqual([0, 6, 6, 15]);
		const total = tokenize(stripCitations(fullText)).length;
		expect(total).toBe(17);
	});

	it("returns null when the page texts do not add up to the full text", () => {
		expect(
			computePageStarts(["One two", "three"], "One two three four"),
		).toBeNull();
	});

	it("returns null without pages", () => {
		expect(computePageStarts([], "Some text")).toBeNull();
	});
});

describe("pageForWord", () => {
	const starts = [0, 6, 6, 16];

	it("finds the page containing a word", () => {
		expect(pageForWord(starts, 0)).toBe(0);
		expect(pageForWord(starts, 5)).toBe(0);
		expect(pageForWord(starts, 15)).toBe(2);
		expect(pageForWord(starts, 16)).toBe(3);
		expect(pageForWord(starts, 99)).toBe(3);
	});

	it("skips a blank page and lands on the page that has the word", () => {
		expect(pageForWord(starts, 6)).toBe(2);
	});
});
