import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DocSession, SavedDocument } from "../models/types.js";
import { DEFAULT_SETTINGS } from "../services/defaults.js";
import { SESSION_TINTS } from "./session-band.js";

const { docs } = vi.hoisted(() => ({ docs: [] as SavedDocument[] }));
vi.mock("../services/storage-service.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../services/storage-service.js")>();
	return { ...actual, getSavedDocuments: vi.fn(async () => docs) };
});

// The subset of the page's private API this test drives.
interface PageInternals extends HTMLElement {
	profile: { settings: typeof DEFAULT_SETTINGS };
	activeSection: string;
	updateComplete: Promise<boolean>;
}

const words = (n: number) =>
	Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function session(
	id: string,
	startedAt: string,
	spans: { start: number; end: number }[],
): DocSession {
	return {
		id,
		startedAt,
		endedAt: startedAt,
		durationMs: 120_000,
		wordsRead: 0,
		wpm: 300,
		spans,
	};
}

function doc(id: string, text: string, sessions?: DocSession[]): SavedDocument {
	return {
		id,
		title: id,
		text,
		wordCount: text.split(" ").length,
		savedAt: "2026-11-18T10:00:00.000Z",
		resumeWordIndex: 0,
		completionPercent: 0,
		sessions,
	};
}

beforeAll(async () => {
	// jsdom has no matchMedia; imports call it at load time.
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
	await import("./profile-page.js");
});

async function renderLibrary(removeCitations = false): Promise<PageInternals> {
	const el = document.createElement("profile-page") as unknown as PageInternals;
	el.profile = { settings: { ...DEFAULT_SETTINGS, removeCitations } };
	el.activeSection = "library"; // before connecting: the profile tab is never rendered
	document.body.appendChild(el);
	await new Promise((r) => setTimeout(r, 0)); // getSavedDocuments
	await el.updateComplete;
	return el;
}

/** Moves the mouse over the band of `cardEl`, at `frac` of its width (jsdom has no layout: width 200px). */
function hoverBand(cardEl: HTMLElement, frac: number): void {
	const band = cardEl.querySelector<HTMLElement>(".library-session-band");
	if (!band) throw new Error("no session band");
	band.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
	band.dispatchEvent(
		Object.assign(new Event("pointermove"), {
			pointerType: "mouse",
			clientX: frac * 200,
		}),
	);
}

function card(el: HTMLElement, title: string): HTMLElement {
	const titleEl = [...el.querySelectorAll(".font-semibold.truncate")].find(
		(t) => t.textContent?.trim() === title,
	);
	const found = titleEl?.closest<HTMLElement>(".group");
	if (!found) throw new Error(`no card for ${title}`);
	return found;
}

describe("profile-page library sessions", () => {
	it("shows the session band, count, label and first-unread button per document", async () => {
		docs.length = 0;
		docs.push(
			doc("gap", words(100), [
				session("a", "2026-11-18T09:00:00.000Z", [{ start: 0, end: 19 }]),
				session("b", "2026-11-18T10:00:00.000Z", [{ start: 60, end: 79 }]),
			]),
			doc("done", words(100), [
				session("c", "2026-11-18T09:00:00.000Z", [{ start: 0, end: 99 }]),
			]),
			doc("fresh", words(100)),
		);
		const el = await renderLibrary();

		const gap = card(el, "gap");
		const pieces = [
			...gap.querySelectorAll<HTMLElement>(".library-session-piece"),
		];
		expect(pieces.map((p) => p.dataset.session)).toEqual(["1", "2"]);
		const pct = (v: string) => Math.round(Number.parseFloat(v));
		expect(pieces.map((p) => pct(p.style.left))).toEqual([0, 60]);
		expect(pieces.map((p) => pct(p.style.width))).toEqual([20, 20]);
		expect(pieces[0].className).toContain(SESSION_TINTS[0]);
		expect(pieces[1].className).toContain(SESSION_TINTS[1]);
		const band = gap.querySelector(".library-session-band");
		expect(band?.getAttribute("role")).toBe("img");
		expect(band?.getAttribute("aria-label")).toBe("2 sessions, 40% read");
		expect(gap.textContent).toContain("2 sessions");
		expect(gap.textContent).not.toContain("Fully read");
		expect(gap.textContent).toContain("Continue at first unread");

		const done = card(el, "done");
		expect(done.querySelectorAll(".library-session-piece")).toHaveLength(1);
		expect(done.textContent).toContain("1 session");
		expect(done.textContent).toContain("Fully read");
		expect(done.textContent).not.toContain("Continue at first unread");

		const fresh = card(el, "fresh");
		expect(fresh.querySelector(".library-session-band")).toBeNull();
		expect(fresh.textContent).not.toContain("session");
		expect(fresh.textContent).not.toContain("Continue at first unread");

		// Hover on a block shows that session's line, placed above the card.
		const shown: { text: string; above?: HTMLElement }[] = [];
		const onShow = (e: Event) =>
			shown.push(
				(e as CustomEvent<{ text: string; above?: HTMLElement }>).detail,
			);
		window.addEventListener("speeedy:show-tooltip", onShow);
		hoverBand(gap, 0.65);
		window.removeEventListener("speeedy:show-tooltip", onShow);
		expect(shown).toHaveLength(1);
		expect(shown[0].text).toMatch(/^Session 2 · .* · 2 min · 300 wpm$/);
		expect(shown[0].above).toBe(gap);
		el.remove();
	});

	it("draws no completion bar: the resume button carries the percentage", async () => {
		docs.length = 0;
		docs.push(
			{ ...doc("old", words(100)), completionPercent: 50 },
			{
				...doc("read", words(100), [
					session("a", "2026-11-18T09:00:00.000Z", [{ start: 0, end: 49 }]),
				]),
				completionPercent: 50,
			},
		);
		const el = await renderLibrary();
		for (const title of ["old", "read"]) {
			const c = card(el, title);
			expect(c.querySelector(".bg-primary\\/60")).toBeNull();
			expect(c.querySelectorAll(".rounded-full.overflow-hidden")).toHaveLength(
				title === "read" ? 1 : 0,
			);
			expect(c.textContent).toContain("Resume 50%");
		}
		el.remove();
	});

	it("opens the reader at the first unread word, in the filtered stream when the filter is on", async () => {
		// Plain words: a0 a1 [1] a2 ... — the citation "[1]" is word 2 in plain numbering.
		const text = `a0 a1 [1] ${words(20)}`;
		docs.length = 0;
		docs.push(
			doc("cited", text, [
				session("a", "2026-11-18T09:00:00.000Z", [{ start: 0, end: 9 }]),
			]),
		);
		const navigations: number[] = [];
		const onNav = (e: Event) =>
			navigations.push(
				(e as CustomEvent<{ resumeWordIndex: number }>).detail.resumeWordIndex,
			);
		window.addEventListener("speeedy:navigate", onNav);

		for (const filter of [false, true]) {
			const el = await renderLibrary(filter);
			const button = [...el.querySelectorAll("button")].find(
				(b) => b.textContent?.trim() === "Continue at first unread",
			);
			button?.click();
			el.remove();
		}
		window.removeEventListener("speeedy:navigate", onNav);
		// Plain 10 is the first unread word; without "[1]" it is one word earlier.
		expect(navigations).toEqual([10, 9]);
	});

	it("counts words in removed citations as read when the filter is on", async () => {
		// 300 words ending in a citation of 7 words: plain 307, filtered 300.
		const text = `${words(300)} [1, 2, 3, 4, 5, 6, 7].`;
		docs.length = 0;
		// Read to the end with the filter on: the filtered stream ends at plain word 299.
		docs.push(
			doc("cited", text, [
				session("a", "2026-11-18T09:00:00.000Z", [{ start: 0, end: 299 }]),
			]),
		);
		const on = await renderLibrary(true);
		expect(card(on, "cited").textContent).toContain("Fully read");
		on.remove();
		// Without the filter the citation was shown and is not read.
		const off = await renderLibrary(false);
		expect(card(off, "cited").textContent).not.toContain("Fully read");
		expect(card(off, "cited").textContent).toContain(
			"Continue at first unread",
		);
		off.remove();
	});

	it("updates the session lines when the pages of a document arrive later", async () => {
		const text = words(100);
		const sessions = [
			session("a", "2026-11-18T09:00:00.000Z", [{ start: 0, end: 79 }]),
		];
		docs.length = 0;
		docs.push(doc("paged", text, sessions));
		const el = (await renderLibrary()) as PageInternals & {
			savedDocs: SavedDocument[];
		};
		const hover = () => {
			const shown: string[] = [];
			const onShow = (e: Event) =>
				shown.push((e as CustomEvent<{ text: string }>).detail.text);
			window.addEventListener("speeedy:show-tooltip", onShow);
			hoverBand(card(el, "paged"), 0.1);
			window.removeEventListener("speeedy:show-tooltip", onShow);
			return shown[0];
		};
		expect(hover()).not.toContain("p. ");
		// A re-import fills in the pages; text and sessions stay the same.
		el.savedDocs = [
			{ ...doc("paged", text, sessions), pages: [words(50), words(50)] },
		];
		await el.updateComplete;
		expect(hover()).toContain("p. 1 → p. 2");
		el.remove();
	});

	it("hides an open session tip when the library section goes away", async () => {
		const text = words(100);
		docs.length = 0;
		docs.push(
			doc("tip", text, [
				session("a", "2026-11-18T09:00:00.000Z", [{ start: 0, end: 79 }]),
			]),
		);
		const el = (await renderLibrary()) as PageInternals & {
			libraryPage: number;
		};
		let hides = 0;
		const onHide = () => hides++;
		window.addEventListener("speeedy:hide-tooltip", onHide);
		hoverBand(card(el, "tip"), 0.1);
		el.activeSection = "data";
		await el.updateComplete;
		expect(hides).toBe(1);
		window.removeEventListener("speeedy:hide-tooltip", onHide);
		el.remove();
	});
});
