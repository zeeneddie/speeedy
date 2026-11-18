import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
		getSavedDocuments: vi.fn(async () => []),
	};
});

// The subset of the reader's private API this test drives.
interface ReaderInternals {
	settings: typeof DEFAULT_SETTINGS;
	rawDocText: string;
	savedDocId: string | null;
	engine: {
		load(text: string, settings: typeof DEFAULT_SETTINGS): void;
		getState(): { playing: boolean; displayWordIndex: number };
	};
	sessionRecorder: { onWords(index: number, count: number, now: number): void };
	saveDocSession(): void;
	handleSettingsChange(e: CustomEvent): void;
	handleVisibilityChange(): void;
	togglePlay(): void;
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

	afterEach(() => {
		vi.useRealTimers();
		setVisibility("visible");
	});

	it("pauses a playing reader when the tab is hidden, so no unseen words are recorded", () => {
		vi.useFakeTimers();
		appendSpy.mockClear();
		const reader = makeReader(words(500).join(" "));
		// Connected, so the reader's own word listener feeds the recorder.
		Object.assign(reader, {
			profile: { settings: { removeCitations: false } },
		});
		document.body.appendChild(reader as unknown as Node);
		reader.togglePlay(); // the play/pause button's path
		vi.advanceTimersByTime(5_000);
		expect(reader.engine.getState().playing).toBe(true);

		setVisibility("hidden");
		reader.handleVisibilityChange();
		expect(reader.engine.getState().playing).toBe(false);
		expect(appendSpy).toHaveBeenCalledTimes(1);
		const shown = reader.engine.getState().displayWordIndex;

		// Background timers keep running while the tab is hidden.
		vi.advanceTimersByTime(60_000);
		expect(reader.engine.getState().displayWordIndex).toBe(shown);

		// No automatic resume on return, and nothing left to store.
		setVisibility("visible");
		reader.handleVisibilityChange();
		expect(reader.engine.getState().playing).toBe(false);
		reader.saveDocSession();
		expect(appendSpy).toHaveBeenCalledTimes(1);
		(reader as unknown as Element).remove();
	});

	it("keeps a short text read to the end", () => {
		appendSpy.mockClear();
		const reader = makeReader(words(8).join(" "));
		for (let i = 0; i < 8; i++) reader.sessionRecorder.onWords(i, 1, i * 100);
		reader.saveDocSession();
		expect(appendSpy).toHaveBeenCalledTimes(1);
		expect(appendSpy.mock.calls[0][1].spans).toEqual([{ start: 0, end: 7 }]);
	});

	it("adds the stored session once, also when the document load already brought it in", async () => {
		const reader = makeReader(words(100).join(" ")) as ReaderInternals & {
			docSessions: { id: string }[];
		};
		// The document load finishes while the write is pending and reads the new session from the store.
		appendSpy.mockReset();
		appendSpy.mockImplementation(async (_id, stored) => {
			reader.docSessions = [stored];
		});
		for (let i = 0; i < 30; i++) reader.sessionRecorder.onWords(i, 1, i * 300);
		reader.saveDocSession();
		await new Promise((r) => setTimeout(r, 0));
		expect(reader.docSessions).toHaveLength(1);
		appendSpy.mockReset();
	});
});

describe("rsvp-reader session layer", () => {
	const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);
	const session = (
		startedAt: string,
		spans: { start: number; end: number }[],
	) => ({
		id: startedAt,
		startedAt,
		endedAt: startedAt,
		durationMs: 120_000,
		wordsRead: 50,
		wpm: 300,
		spans,
	});
	const mount = async (showSessions: boolean) => {
		const reader = document.createElement("rsvp-reader");
		const r = reader as unknown as ReaderInternals & {
			docSessions: unknown[];
			profile: unknown;
			updateComplete: Promise<boolean>;
			requestUpdate(): void;
		};
		r.profile = {
			settings: { removeCitations: false, progressShowSessions: showSessions },
		};
		document.body.appendChild(reader);
		const text = words(200).join(" ");
		r.rawDocText = text;
		r.engine.load(text, r.settings);
		r.docSessions = [
			session("2026-11-18T10:00:00Z", [{ start: 0, end: 49 }]),
			// Second session read two stretches with a jump in between.
			session("2026-11-18T12:00:00Z", [
				{ start: 100, end: 119 },
				{ start: 150, end: 199 },
			]),
		];
		r.requestUpdate();
		await r.updateComplete;
		return reader;
	};

	it("draws one block per read stretch, alternating tints per session", async () => {
		const el = await mount(true);
		const pieces = [...el.querySelectorAll<HTMLElement>(".session-piece")];
		const pct = (v: string) => Math.round(Number.parseFloat(v) * 100) / 100;
		expect(
			pieces.map((p) => [
				p.dataset.session,
				pct(p.style.left),
				pct(p.style.width),
			]),
		).toEqual([
			["1", 0, 25],
			["2", 50, 10],
			["2", 75, 25],
		]);
		expect(pieces[0].classList.contains("bg-info")).toBe(true);
		expect(pieces[1].classList.contains("bg-info/45")).toBe(true);
		// Blocks never take pointer events: clicks reach the seek bar.
		expect(
			pieces.every((p) => p.className.includes("pointer-events-none")),
		).toBe(true);
		el.remove();
	});

	it("shows the newest session where sessions overlap: it is drawn on top", async () => {
		const el = await mount(true);
		const r = el as unknown as {
			docSessions: unknown[];
			requestUpdate(): void;
			updateComplete: Promise<boolean>;
			showSessionTip(e: Partial<PointerEvent>): void;
		};
		r.docSessions = [
			session("2026-11-18T10:00:00Z", [{ start: 0, end: 199 }]),
			session("2026-11-18T12:00:00Z", [{ start: 80, end: 119 }]),
		];
		r.requestUpdate();
		await r.updateComplete;
		const band = el.querySelector<HTMLElement>(".session-band");
		if (!band) throw new Error("no session band");
		band.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
		const shown: string[] = [];
		const onShow = (e: Event) =>
			shown.push((e as CustomEvent<{ text: string }>).detail.text);
		window.addEventListener("speeedy:show-tooltip", onShow);
		for (const clientX of [100, 20]) {
			r.showSessionTip({ currentTarget: band, clientX });
		}
		window.removeEventListener("speeedy:show-tooltip", onShow);
		expect(shown.map((t) => t.split(" · ")[0])).toEqual([
			"Session 2",
			"Session 1",
		]);
		el.remove();
	});

	it("draws nothing when progressShowSessions is off", async () => {
		const el = await mount(false);
		expect(el.querySelectorAll(".session-piece")).toHaveLength(0);
		expect(el.querySelector(".session-band")).toBeNull();
		el.remove();
	});
});
