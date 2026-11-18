import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const OUTLINE_PDF = join(
	import.meta.dirname,
	"../test-fixtures/outline/arxiv-2312.00752-mamba-outline.pdf",
);

interface StoredDoc {
	id: string;
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
