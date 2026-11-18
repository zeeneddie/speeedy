import { describe, expect, it } from "vitest";
import { tokenize } from "./rsvp-engine.js";
import {
	markdownSegments,
	type PdfOutlineSource,
	pdfToc,
	refineStart,
	tocFromSegments,
	withPages,
} from "./toc.js";

const wordAt = (text: string, index: number) => tokenize(text)[index]?.text;

describe("Markdown table of contents", () => {
	const md =
		"Intro line before any heading.\n\n# Chapter One\n\nFirst words here.\n\n## Section A\nMore text.\n\n# Chapter Two ##\n\nLast.";

	it("finds headings with their level and first word", () => {
		const toc = tocFromSegments(markdownSegments(md), md);
		expect(toc.map((e) => [e.title, e.level])).toEqual([
			["Chapter One", 1],
			["Section A", 2],
			["Chapter Two", 1],
		]);
		// The reader does not show the "#" as a word, so a heading starts at its first word.
		expect(wordAt(md, toc[0].startWord)).toBe("Chapter");
		expect(wordAt(md, toc[1].startWord)).toBe("Section");
		expect(wordAt(md, toc[2].startWord)).toBe("Chapter");
	});

	it("does not take a # line inside a code fence for a heading", () => {
		const fenced =
			"# Real\n\n```bash\n# just a comment\necho hi\n```\n\n## Also real\nText.";
		const toc = tocFromSegments(markdownSegments(fenced), fenced);
		expect(toc.map((e) => e.title)).toEqual(["Real", "Also real"]);
	});

	it("closes a fence only with the same character and at least its length", () => {
		const nested =
			"# Real\n\n````md\n```\n# Fake\n```\n````\n\n## Also real\nText.";
		expect(
			tocFromSegments(markdownSegments(nested), nested).map((e) => e.title),
		).toEqual(["Real", "Also real"]);
	});

	it("does not close a backtick fence with tildes, or the other way round", () => {
		const mixed =
			"# Real\n\n~~~\n```\n# Fake\n~~~~\n\n## Also real\n```\nText.";
		expect(
			tocFromSegments(markdownSegments(mixed), mixed).map((e) => e.title),
		).toEqual(["Real", "Also real"]);
	});

	it("gives no entries when the segments do not add up to the text", () => {
		expect(
			tocFromSegments(
				[{ text: "a b", heading: { title: "X", level: 1 } }],
				"a b c",
			),
		).toEqual([]);
	});
});

describe("refineStart", () => {
	const tokens = ["intro", "text", "the", "big", "idea", "follows"];

	it("finds the heading words inside the range", () => {
		expect(refineStart(tokens, 0, 6, "The Big Idea")).toBe(2);
	});

	it("falls back to the start of the range", () => {
		expect(refineStart(tokens, 1, 6, "Missing title")).toBe(1);
	});
});

describe("pdfToc", () => {
	const pages = [
		"Cover page.",
		"Introduction This book starts here.",
		"Some text. Methods We describe methods. More.",
	];
	const text = pages.join("\n\n");
	const refs = [{ num: 1 }, { num: 2 }, { num: 3 }];
	const source: PdfOutlineSource = {
		getOutline: async () => [
			{ title: "Introduction", dest: "intro", items: [] },
			{
				title: "Main",
				dest: [refs[2]],
				items: [{ title: "Methods", dest: [refs[2]], items: [] }],
			},
			{ title: "Broken", dest: "nowhere", items: [] },
		],
		getDestination: async (id) => (id === "intro" ? [refs[1]] : null),
		getPageIndex: async (ref) => refs.indexOf(ref as { num: number }),
	};

	it("reads the outline with levels, pages and refined first words", async () => {
		const toc = await pdfToc(source, pages, text);
		expect(toc.map((e) => [e.title, e.level, e.page])).toEqual([
			["Introduction", 1, 1],
			["Main", 1, 2],
			["Methods", 2, 2],
		]);
		expect(wordAt(text, toc[0].startWord)).toBe("Introduction");
		expect(wordAt(text, toc[2].startWord)).toBe("Methods");
		// "Main" is not on the page as words: it starts at the top of its page.
		expect(wordAt(text, toc[1].startWord)).toBe("Some");
	});

	it("starts an entry on its own page when the outline runs out of order", async () => {
		const backwards: PdfOutlineSource = {
			...source,
			getOutline: async () => [
				{ title: "Methods", dest: [refs[2]], items: [] },
				{ title: "Introduction", dest: "intro", items: [] },
			],
		};
		const toc = await pdfToc(backwards, pages, text);
		expect(toc.map((e) => [e.title, e.page])).toEqual([
			["Methods", 2],
			["Introduction", 1],
		]);
		expect(wordAt(text, toc[1].startWord)).toBe("Introduction");
	});

	it("is empty without an outline", async () => {
		const none: PdfOutlineSource = { ...source, getOutline: async () => null };
		expect(await pdfToc(none, pages, text)).toEqual([]);
	});
});

describe("withPages", () => {
	it("adds the page of each entry from the page starts", () => {
		expect(
			withPages(
				[{ title: "A", level: 1, startWord: 7, page: null }],
				[0, 5, 10],
			),
		).toEqual([{ title: "A", level: 1, startWord: 7, page: 1 }]);
	});
});
