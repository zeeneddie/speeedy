import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DocSession, SavedDocument } from "../models/types.js";
import { DEFAULT_SETTINGS } from "../services/defaults.js";

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
		expect(pieces[0].classList.contains("bg-info")).toBe(true);
		expect(pieces[1].classList.contains("bg-info/45")).toBe(true);
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

		// Hover on a block shows that session's line.
		const shown: string[] = [];
		const onShow = (e: Event) =>
			shown.push((e as CustomEvent<{ text: string }>).detail.text);
		window.addEventListener("speeedy:show-tooltip", onShow);
		pieces[1].dispatchEvent(
			Object.assign(new Event("pointerenter"), { pointerType: "mouse" }),
		);
		window.removeEventListener("speeedy:show-tooltip", onShow);
		expect(shown).toHaveLength(1);
		expect(shown[0]).toMatch(/^Session 2 · .* · 2 min · 300 wpm$/);
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
});
