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

// The subset of the reader's private API this test drives.
interface ReaderInternals {
	settings: typeof DEFAULT_SETTINGS;
	rawDocText: string;
	engine: { load(text: string, settings: typeof DEFAULT_SETTINGS): void };
	saveDocSession(): void;
	handleSettingsChange(e: CustomEvent): void;
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
