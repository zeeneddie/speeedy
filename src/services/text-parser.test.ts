import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenize } from "./rsvp-engine.js";
import {
	applyBionicReading,
	createDocFromText,
	parseFile,
} from "./text-parser.js";

describe("applyBionicReading", () => {
	it("wraps the first ~40% of each word in bold tags", () => {
		const result = applyBionicReading("hello");
		// "hello" has 5 chars, 40% = 2 → bold first 2 chars
		expect(result).toBe("<b>he</b>llo");
	});

	it("handles single character word", () => {
		const result = applyBionicReading("a");
		// 1 char, ceil(0.4) = 1 → entire word bolded
		expect(result).toBe("<b>a</b>");
	});

	it("handles two character word", () => {
		const result = applyBionicReading("hi");
		// 2 chars, ceil(0.8) = 1 → bold first 1 char
		expect(result).toBe("<b>h</b>i");
	});

	it("processes multiple words", () => {
		const result = applyBionicReading("hello world");
		expect(result).toContain("<b>");
		expect(result).toContain("</b>");
		// Should have two bold segments
		const boldCount = (result.match(/<b>/g) ?? []).length;
		expect(boldCount).toBe(2);
	});

	it("escapes HTML special characters in word content", () => {
		const result = applyBionicReading("a&b");
		expect(result).toContain("&amp;");
	});

	it("handles words with punctuation", () => {
		const result = applyBionicReading("hello,");
		// "hello," has 6 chars, clean = "hello" (5 chars), boldLen = ceil(5*0.4) = 2
		// bold first 2 chars of "hello,"
		expect(result).toContain("<b>he</b>");
	});

	it("handles empty string", () => {
		const result = applyBionicReading("");
		expect(result).toBe("");
	});

	it("handles punctuation-only word", () => {
		const result = applyBionicReading("...");
		// clean = "" (no letters/numbers), returns escaped word
		expect(result).toBe("...");
	});

	it("escapes angle brackets", () => {
		const result = applyBionicReading("a<b");
		expect(result).toContain("&lt;");
	});

	it("escapes quotes", () => {
		const result = applyBionicReading('say"hi"');
		expect(result).toContain("&quot;");
	});
});

describe("parseFile (EPUB)", () => {
	it("extracts text and title from a valid EPUB", async () => {
		const buffer = readFileSync(
			join(import.meta.dirname, "../../test-fixtures/sample.epub"),
		);
		const file = new File([buffer], "sample.epub", {
			type: "application/epub+zip",
		});

		const doc = await parseFile(file);

		expect(doc.title).toBe("Test Book");
		expect(doc.text).toContain("Hello EPUB world");
		expect(doc.wordCount).toBeGreaterThan(0);
	});
});

describe("createDocFromText", () => {
	it("creates a document with the given text", () => {
		const doc = createDocFromText("Hello world");
		expect(doc.text).toBe("Hello world");
	});

	it("uses default title 'Untitled' when not provided", () => {
		const doc = createDocFromText("Some text");
		expect(doc.title).toBe("Untitled");
	});

	it("uses provided title", () => {
		const doc = createDocFromText("Some text", "My Book");
		expect(doc.title).toBe("My Book");
	});

	it("counts words correctly", () => {
		const doc = createDocFromText("one two three four five");
		expect(doc.wordCount).toBe(5);
	});

	it("cleans up excessive whitespace", () => {
		const doc = createDocFromText("hello   world");
		expect(doc.text).toBe("hello world");
	});

	it("normalizes Windows line endings", () => {
		const doc = createDocFromText("line one\r\nline two");
		expect(doc.text).not.toContain("\r");
		expect(doc.text).toContain("\n");
	});

	it("collapses more than 2 consecutive newlines to 2", () => {
		const doc = createDocFromText("para one\n\n\n\npara two");
		expect(doc.text).toBe("para one\n\npara two");
	});

	it("trims leading and trailing whitespace", () => {
		const doc = createDocFromText("   hello world   ");
		expect(doc.text).toBe("hello world");
	});

	it("returns wordCount of 0 for empty text", () => {
		const doc = createDocFromText("");
		expect(doc.wordCount).toBe(0);
	});

	it("handles text with only whitespace", () => {
		const doc = createDocFromText("   \n\n   ");
		expect(doc.text).toBe("");
		expect(doc.wordCount).toBe(0);
	});
});

describe("table of contents while parsing", () => {
	const fixture = (name: string, type: string) =>
		new File(
			[readFileSync(join(import.meta.dirname, `../../test-fixtures/${name}`))],
			name.split("/").pop() ?? name,
			{ type },
		);
	const wordAt = (text: string, index: number) => tokenize(text)[index]?.text;

	it("reads Word headings (Heading 1, 2) with their first word", async () => {
		const doc = await parseFile(
			fixture(
				"docx/headings.docx",
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			),
		);
		expect(doc.text).toContain("Voorwoord zonder kop");
		expect(doc.toc?.map((e) => [e.title, e.level])).toEqual([
			["Introductie", 1],
			["Achtergrond", 2],
			["Conclusie", 1],
		]);
		expect(doc.toc?.map((e) => wordAt(doc.text, e.startWord))).toEqual([
			"Introductie",
			"Achtergrond",
			"Conclusie",
		]);
	});

	// Text (and so the content hash) must stay what mammoth.extractRawText gave before
	// the table of contents existed, or a re-import creates a duplicate document.
	it.each([
		"headings.docx",
		"bold-no-heading-styles.docx",
		"footnote-and-break.docx",
	])("keeps the extractRawText text for Word file %s", async (name) => {
		const docx = fixture(
			`docx/${name}`,
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		const mammoth = await import("mammoth");
		const raw = await mammoth.extractRawText({
			arrayBuffer: await docx.arrayBuffer(),
		});
		// Same post-processing as parseDocx applied to extractRawText (cleanText).
		const expected = raw.value
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/[ \t]{2,}/g, " ")
			.trim();
		expect((await parseFile(docx)).text).toBe(expected);
	});

	it("drops footnote references and notes, and joins soft line breaks like before", async () => {
		const doc = await parseFile(
			fixture(
				"docx/footnote-and-break.docx",
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			),
		);
		expect(doc.text).toBe(
			"Eerste zin met voetnoot en verder.\n\nRegel eenregel twee.",
		);
	});

	it("gives no table of contents for Word text that is only bold, without heading styles", async () => {
		const doc = await parseFile(
			fixture(
				"docx/bold-no-heading-styles.docx",
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			),
		);
		expect(doc.text).toContain("Tekst onder een vetgedrukte regel.");
		expect(doc.toc).toEqual([]);
	});

	it("reads Markdown headings", async () => {
		const file = new File(["# Een\n\nTekst.\n\n## Twee\n\nMeer."], "notes.md", {
			type: "text/markdown",
		});
		const doc = await parseFile(file);
		expect(doc.toc?.map((e) => e.title)).toEqual(["Een", "Twee"]);
	});

	const tocNav =
		'<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="text/ch1.xhtml">First chapter</a><ol><li><a href="text/ch1.xhtml#s">Inner part</a></li></ol></li><li><a href="text/ch2.xhtml">Second chapter</a></li></ol></nav>';

	async function makeEpub(
		withNav: "nav" | "ncx",
		navBody = tocNav,
	): Promise<File> {
		const { default: JSZip } = await import("jszip");
		const zip = new JSZip();
		zip.file("mimetype", "application/epub+zip");
		zip.file(
			"META-INF/container.xml",
			'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		);
		const navItem =
			withNav === "nav"
				? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
				: '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>';
		zip.file(
			"OEBPS/content.opf",
			`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Toc Book</dc:title></metadata><manifest>${navItem}<item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
		);
		const page = (body: string) =>
			`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`;
		zip.file(
			"OEBPS/text/ch1.xhtml",
			page(
				'<h1>First chapter</h1><p>Alpha words here.</p><h2 id="s">Inner part</h2><p>Beta words.</p>',
			),
		);
		zip.file(
			"OEBPS/text/ch2.xhtml",
			page("<h1>Second chapter</h1><p>Gamma words.</p>"),
		);
		zip.file("OEBPS/nav.xhtml", page(navBody));
		zip.file(
			"OEBPS/toc.ncx",
			'<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>First chapter</text></navLabel><content src="text/ch1.xhtml"/><navPoint><navLabel><text>Inner part</text></navLabel><content src="text/ch1.xhtml#s"/></navPoint></navPoint><navPoint><navLabel><text>Second chapter</text></navLabel><content src="text/ch2.xhtml"/></navPoint></navMap></ncx>',
		);
		const blob = await zip.generateAsync({ type: "arraybuffer" });
		return new File([blob], "book.epub", { type: "application/epub+zip" });
	}

	for (const kind of ["nav", "ncx"] as const) {
		it(`reads the EPUB table of contents from the ${kind === "nav" ? "EPUB 3 nav" : "EPUB 2 NCX"}`, async () => {
			const doc = await parseFile(await makeEpub(kind));
			expect(doc.toc?.map((e) => [e.title, e.level])).toEqual([
				["First chapter", 1],
				["Inner part", 2],
				["Second chapter", 1],
			]);
			expect(doc.toc?.map((e) => wordAt(doc.text, e.startWord))).toEqual([
				"First",
				"Inner",
				"Second",
			]);
		});
	}

	it("picks the toc nav by its OPS namespace, whatever the prefix", async () => {
		// A landmarks nav comes first; the prefix is "ops", not "epub".
		const navs =
			'<div xmlns:ops="http://www.idpf.org/2007/ops"><nav ops:type="landmarks"><ol><li><a href="text/ch2.xhtml">Second chapter</a></li></ol></nav><nav ops:type="toc"><ol><li><a href="text/ch1.xhtml">First chapter</a></li><li><a href="text/ch2.xhtml">Second chapter</a></li></ol></nav></div>';
		const doc = await parseFile(await makeEpub("nav", navs));
		expect(doc.toc?.map((e) => e.title)).toEqual([
			"First chapter",
			"Second chapter",
		]);
	});
});
