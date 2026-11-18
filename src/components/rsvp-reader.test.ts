import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../services/defaults.js";

// Count how often the word map is built while keeping its real behaviour.
const { buildWordMapSpy } = vi.hoisted(() => ({ buildWordMapSpy: vi.fn() }));
vi.mock("../services/reading-progress.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../services/reading-progress.js")>();
	buildWordMapSpy.mockImplementation(actual.buildWordMap);
	return { ...actual, buildWordMap: buildWordMapSpy };
});

// Record the session writes instead of touching IndexedDB.
const { appendSpy } = vi.hoisted(() => ({ appendSpy: vi.fn() }));
vi.mock("../services/storage-service.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../services/storage-service.js")>();
	return {
		...actual,
		appendDocumentSession: appendSpy,
		updateDocumentProgress: vi.fn(async () => {}),
	};
});

// The subset of the reader's private API this test drives.
interface ReaderInternals {
	settings: typeof DEFAULT_SETTINGS;
	rawDocText: string;
	savedDocId: string | null;
	engine: { load(text: string, settings: typeof DEFAULT_SETTINGS): void };
	sessionRecorder: { onWords(index: number, count: number, now: number): void };
	saveDocSession(): void;
	handleSettingsChange(e: CustomEvent): void;
	handleVisibilityChange(): void;
}

beforeAll(async () => {
	// jsdom has no matchMedia; the reader's imports call it at load time.
	window.matchMedia ??= ((query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		onchange: null,
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
	await import("./rsvp-reader.js");
});

describe("rsvp-reader word map", () => {
	it("builds the map once per document and filter setting", async () => {
		const { stripCitations } = await import("../utils/text-utils.js");
		const reader = document.createElement(
			"rsvp-reader",
		) as unknown as ReaderInternals;
		const text = "One two [1] three four (Smith et al., 2020) five six.";
		reader.settings = { ...DEFAULT_SETTINGS, removeCitations: true };
		reader.rawDocText = text;
		reader.engine.load(stripCitations(text), reader.settings);

		reader.saveDocSession();
		reader.saveDocSession();
		expect(buildWordMapSpy).toHaveBeenCalledTimes(1);

		const toggle = (removeCitations: boolean) =>
			reader.handleSettingsChange(
				new CustomEvent("change", {
					detail: { ...reader.settings, removeCitations },
				}),
			);
		toggle(false); // closes the session under the old (cached) map
		reader.saveDocSession(); // filter off: no map needed
		expect(buildWordMapSpy).toHaveBeenCalledTimes(1);
		toggle(true); // re-tokenizes: a new stream
		reader.saveDocSession();
		reader.saveDocSession();
		expect(buildWordMapSpy).toHaveBeenCalledTimes(2);
	});
});

describe("rsvp-reader sessions", () => {
	const makeReader = (text: string) => {
		const reader = document.createElement(
			"rsvp-reader",
		) as unknown as ReaderInternals;
		reader.settings = { ...DEFAULT_SETTINGS, removeCitations: false };
		reader.rawDocText = text;
		reader.savedDocId = "doc";
		reader.engine.load(text, reader.settings);
		return reader;
	};
	const setVisibility = (state: DocumentVisibilityState) =>
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => state,
		});
	const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

	it("saves the session when the tab is hidden, and starts a new one on return", () => {
		appendSpy.mockClear();
		const reader = makeReader(words(100).join(" "));
		for (let i = 0; i < 30; i++) reader.sessionRecorder.onWords(i, 1, i * 300);

		setVisibility("hidden");
		reader.handleVisibilityChange();
		expect(appendSpy).toHaveBeenCalledTimes(1);
		expect(appendSpy.mock.calls[0][1].spans).toEqual([{ start: 0, end: 29 }]);

		setVisibility("visible");
		reader.handleVisibilityChange();
		for (let i = 30; i < 60; i++)
			reader.sessionRecorder.onWords(i, 1, 100_000 + i * 300);
		setVisibility("hidden");
		reader.handleVisibilityChange();
		// Only the words read after the return: nothing is stored twice.
		expect(appendSpy).toHaveBeenCalledTimes(2);
		expect(appendSpy.mock.calls[1][1].spans).toEqual([{ start: 30, end: 59 }]);
		setVisibility("visible");
	});

	it("keeps a short text read to the end", () => {
		appendSpy.mockClear();
		const reader = makeReader(words(8).join(" "));
		for (let i = 0; i < 8; i++) reader.sessionRecorder.onWords(i, 1, i * 100);
		reader.saveDocSession();
		expect(appendSpy).toHaveBeenCalledTimes(1);
		expect(appendSpy.mock.calls[0][1].spans).toEqual([{ start: 0, end: 7 }]);
	});
});
