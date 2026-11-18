import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const OUTLINE_PDF = join(
	import.meta.dirname,
	"../test-fixtures/outline/arxiv-2312.00752-mamba-outline.pdf",
);

interface StoredDoc {
	id: string;
	text: string;
	toc?: {
		title: string;
		level: number;
		startWord: number;
		page: number | null;
	}[];
	sessions?: {
		durationMs: number;
		wordsRead: number;
		spans: { start: number; end: number }[];
	}[];
}

async function importToLibrary(page: Page, file: string): Promise<void> {
	await page.goto("/#/profile");
	await page.getByRole("button", { name: "Library" }).click();
	await page
		.locator('speeedy-file-uploader input[type="file"]')
		.setInputFiles(file);
	await expect(page.locator("text=added to your library")).toBeVisible({
		timeout: 90_000,
	});
}

/** Reads the library straight from IndexedDB, or applies a change to the first document. */
async function firstDoc(page: Page, change?: "dropToc"): Promise<StoredDoc> {
	return page.evaluate(
		(change) =>
			new Promise<StoredDoc>((resolve, reject) => {
				const req = indexedDB.open("speeedy-db");
				req.onerror = () => reject(req.error);
				req.onsuccess = () => {
					const tx = req.result.transaction("documents", "readwrite");
					const all = tx.objectStore("documents").getAll();
					all.onsuccess = () => {
						const doc = all.result[0];
						if (change === "dropToc") {
							delete doc.toc;
							tx.objectStore("documents").put(doc);
						}
						tx.oncomplete = () => resolve(doc);
					};
				};
			}),
		change,
	);
}

test.describe("Progress and contents (phase 0)", () => {
	test("a PDF's built-in outline becomes the table of contents", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await importToLibrary(page, OUTLINE_PDF);
		const doc = await firstDoc(page);
		expect(doc.toc).toHaveLength(57);
		expect(doc.toc?.[0]).toMatchObject({
			title: "Introduction",
			level: 1,
			page: 0,
		});
		expect(doc.toc?.filter((e) => e.level === 3)).toHaveLength(24);
		const starts = doc.toc?.map((e) => e.startWord) ?? [];
		expect([...starts].sort((a, b) => a - b)).toEqual(starts);
	});

	test("an older PDF without a stored table of contents gets one when opened", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await importToLibrary(page, OUTLINE_PDF);
		expect((await firstDoc(page, "dropToc")).toc).toBeUndefined();

		await page.goto("/#/reader");
		await expect
			.poll(async () => (await firstDoc(page)).toc?.length, { timeout: 30_000 })
			.toBe(57);
	});

	test("a reading session records what was read, split at a jump", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await importToLibrary(page, OUTLINE_PDF);
		await page.goto("/#/reader");
		await expect(page.getByRole("tab", { name: "Original" })).toBeEnabled({
			timeout: 15_000,
		});

		// A fresh browser shows the welcome dialog first; close it.
		const skip = page.getByRole("button", { name: "Skip" });
		if (await skip.isVisible().catch(() => false)) await skip.click();
		// Start reading by clicking the reading area, as a reader does.
		const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
		const center = { x: viewport.width * 0.35, y: viewport.height * 0.5 };
		await page.mouse.click(center.x, center.y);
		await page.waitForTimeout(4_000);
		// Jump ahead: the words in between are not read.
		for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowDown");
		await page.waitForTimeout(4_000);
		await page.mouse.click(center.x, center.y);
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(/#\/app/);

		await expect
			.poll(async () => (await firstDoc(page)).sessions?.length ?? 0, {
				timeout: 10_000,
			})
			.toBe(1);
		const [session] = (await firstDoc(page)).sessions ?? [];
		expect(session.spans.length).toBeGreaterThanOrEqual(2);
		expect(session.spans[1].start - session.spans[0].end).toBeGreaterThan(50);
		expect(session.wordsRead).toBeGreaterThanOrEqual(20);
		expect(session.durationMs).toBeGreaterThanOrEqual(5_000);
	});
});

/** Closes the welcome dialog; it opens 600 ms after the app page shows, until skipped once. */
async function dismissWelcome(page: Page): Promise<void> {
	const skip = page.getByRole("button", { name: "Skip" });
	try {
		await skip.click({ timeout: 2_000 });
	} catch {
		// Already skipped in this browser.
	}
}

/** Opens the reader on the last document and reads for `ms`, optionally after jumping ahead first. */
async function readSession(page: Page, ms: number, jumps = 0): Promise<void> {
	await page.goto("/#/reader");
	await expect(page.getByRole("tab", { name: "Original" })).toBeEnabled({
		timeout: 15_000,
	});
	for (let i = 0; i < jumps; i++) await page.keyboard.press("ArrowDown");
	const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
	const center = { x: viewport.width * 0.35, y: viewport.height * 0.5 };
	await page.mouse.click(center.x, center.y);
	await page.waitForTimeout(ms);
	await page.mouse.click(center.x, center.y);
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/#\/app/);
	await dismissWelcome(page);
}

test.describe("Progress (phase 1): sessions on the reader's bar", () => {
	test("two sessions with a jump between show as two groups of blocks, with their own hover line", async ({
		page,
	}) => {
		test.setTimeout(150_000);
		await importToLibrary(page, OUTLINE_PDF);
		await readSession(page, 7_000);
		await expect
			.poll(async () => (await firstDoc(page)).sessions?.length ?? 0)
			.toBe(1);
		// Second session: jump 400 words ahead first, so the stretch in between stays unread.
		await readSession(page, 7_000, 80);
		await expect
			.poll(async () => (await firstDoc(page)).sessions?.length ?? 0)
			.toBe(2);
		const doc = await firstDoc(page);
		const sessions = doc.sessions ?? [];
		// The bar's length in words: the plain token count of the text (citation filter off).
		const total = await page.evaluate(async (text) => {
			const { tokenize } = await import("/src/services/rsvp-engine.ts");
			return tokenize(text).length;
		}, doc.text);

		await page.goto("/#/reader");
		await expect(page.getByRole("tab", { name: "Original" })).toBeEnabled({
			timeout: 15_000,
		});
		await dismissWelcome(page);
		const pieces = page.locator(".session-piece");
		await expect(pieces.first()).toBeAttached({ timeout: 15_000 });

		const drawn = await pieces.evaluateAll((els) =>
			els.map((el) => ({
				session: Number((el as HTMLElement).dataset.session),
				left: Number.parseFloat((el as HTMLElement).style.left),
				width: Number.parseFloat((el as HTMLElement).style.width),
			})),
		);
		// One block per stored stretch, at the place the stretch has in the document.
		const expected = sessions.flatMap((s, i) =>
			s.spans.map((span) => ({
				session: i + 1,
				left: (span.start / total) * 100,
				width: ((span.end + 1 - span.start) / total) * 100,
			})),
		);
		expect(drawn.map((d) => d.session)).toEqual(expected.map((e) => e.session));
		expect(new Set(drawn.map((d) => d.session))).toEqual(new Set([1, 2]));
		drawn.forEach((d, i) => {
			expect(d.left).toBeCloseTo(expected[i].left, 3);
			expect(d.width).toBeCloseTo(expected[i].width, 3);
		});
		// The jump leaves a gap between the groups.
		const first = drawn.filter((d) => d.session === 1).at(-1);
		const second = drawn.find((d) => d.session === 2);
		expect(
			(second?.left ?? 0) - ((first?.left ?? 0) + (first?.width ?? 0)),
		).toBeGreaterThan(0);

		// Hovering a block of session 2 shows that session's line.
		const hoverSecond = async () => {
			const band = await page.locator(".session-band").boundingBox();
			if (!band) throw new Error("no session band");
			await page.mouse.move(band.x + 1, band.y + 1); // onto the band: bar and band grow
			await page.waitForTimeout(300);
			const box = await page
				.locator('.session-piece[data-session="2"]')
				.first()
				.boundingBox();
			if (!box) throw new Error("no block of session 2");
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		};
		await hoverSecond();
		const tip = page.locator("global-tooltip");
		await expect(tip).toHaveClass(/visible/);
		await expect(tip).toContainText(/^\s*Session 2 · /);
		await expect(tip).toContainText(`${sessions[1].wpm} wpm`);
		await expect(tip).toContainText(/p\. \d+/);
		// Optional picture of the bar for a visual check, light and dark (G2_SHOT=path.png).
		const shot = process.env.G2_SHOT;
		if (shot) {
			const clip = { x: 0, y: 0, width: 640, height: 200 };
			await page.waitForTimeout(300); // tooltip fade-in
			await page.screenshot({ path: shot, clip });
			await page.getByRole("button", { name: "Dark" }).click();
			await hoverSecond();
			await expect(tip).toHaveClass(/visible/);
			await page.waitForTimeout(300);
			await page.screenshot({
				path: shot.replace(/\.png$/, "-dark.png"),
				clip,
			});
		}
	});
});
