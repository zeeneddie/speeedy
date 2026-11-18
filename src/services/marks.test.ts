import { describe, expect, it } from "vitest";
import { stripCitations } from "../utils/text-utils.js";
import { createMark, markAt, resolveMarks, sentenceBounds } from "./marks.js";
import { tokenize } from "./rsvp-engine.js";

const TEXT =
	"First sentence here. Second one [1] has a citation! Third?\n\nNew paragraph without end\n\nLast words.";
const tokens = tokenize(TEXT);
const indexOf = (word: string) => tokens.findIndex((t) => t.text === word);

describe("sentenceBounds", () => {
	it("spans from the previous sentence end to this sentence end", () => {
		const [start, end] = sentenceBounds(tokens, indexOf("has"));
		expect(tokens[start].text).toBe("Second");
		expect(tokens[end].text).toBe("citation!");
	});

	it("handles the first and a one-word sentence", () => {
		expect(sentenceBounds(tokens, 1)).toEqual([0, 2]);
		const third = indexOf("Third?");
		expect(sentenceBounds(tokens, third)).toEqual([third, third]);
	});

	it("ends a sentence at a paragraph break even without a full stop", () => {
		const [start, end] = sentenceBounds(tokens, indexOf("without"));
		expect(tokens[start].text).toBe("New");
		expect(tokens[end].text).toBe("end");
	});
});

describe("createMark", () => {
	it("records the sentence, its quote and the text preparation", () => {
		const mark = createMark(tokens, indexOf("a"), "plain", 4);
		const sentence = tokens
			.slice(mark.startWord, mark.endWord + 1)
			.map((t) => t.text)
			.join(" ");
		expect(mark.quote).toBe(sentence);
		expect(mark.quote.startsWith("Second one")).toBe(true);
		expect(mark.page).toBe(4);
		expect(mark.prep).toBe("plain");
		expect(tokens[mark.endWord].text).toBe("citation!");
	});
});

describe("resolveMarks", () => {
	it("keeps word indices under the same text preparation", () => {
		const mark = createMark(tokens, indexOf("has"), "plain", null);
		const [r] = resolveMarks([mark], tokens, "plain");
		expect([r.start, r.end]).toEqual([mark.startWord, mark.endWord]);
	});

	it("finds the sentence again when citations are stripped afterwards", () => {
		const mark = createMark(tokens, indexOf("Last"), "plain", null);
		const stripped = tokenize(stripCitations(TEXT));
		const [r] = resolveMarks([mark], stripped, "noCitations");
		expect(r.start).not.toBeNull();
		expect(stripped[r.start ?? -1].text).toBe("Last");
		expect(stripped[r.end ?? -1].text).toBe("words.");
	});

	it("finds a sentence with a citation after turning the citation filter on", () => {
		const mark = createMark(tokens, indexOf("has"), "plain", null);
		const stripped = tokenize(stripCitations(TEXT));
		const [r] = resolveMarks([mark], stripped, "noCitations");
		expect(stripped[r.start ?? -1].text).toBe("Second");
		expect(stripped[r.end ?? -1].text).toBe("citation!");
	});

	it("finds a sentence with a citation after turning the citation filter off", () => {
		const stripped = tokenize(stripCitations(TEXT));
		const at = stripped.findIndex((t) => t.text === "has");
		const mark = createMark(stripped, at, "noCitations", null);
		const [r] = resolveMarks([mark], tokens, "plain");
		expect(tokens[r.start ?? -1].text).toBe("Second");
		expect(tokens[r.end ?? -1].text).toBe("citation!");
	});

	it("leaves a mark unplaced when its sentence is gone", () => {
		const mark = createMark(tokens, indexOf("Last"), "plain", 2);
		const other = tokenize("Completely different text.");
		const [r] = resolveMarks([mark], other, "noCitations");
		expect(r.start).toBeNull();
		expect(r.mark.page).toBe(2);
	});
});

describe("markAt", () => {
	it("finds the mark covering a word", () => {
		const mark = createMark(tokens, indexOf("has"), "plain", null);
		const resolved = resolveMarks([mark], tokens, "plain");
		expect(markAt(resolved, indexOf("Second"))?.mark.id).toBe(mark.id);
		expect(markAt(resolved, indexOf("Third?"))).toBeUndefined();
	});
});
