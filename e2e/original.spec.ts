import { join } from "node:path";
import { expect, test } from "@playwright/test";

const PDF = join(
	import.meta.dirname,
	"../test-fixtures/01-11-2020-212827The 7 Habits of Highly Effective People.pdf",
);

test.describe("Original file (phase 0)", () => {
	test("importing a PDF stores the original and page texts that map onto the reader's words", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.goto("/#/profile");
		await page.getByRole("button", { name: "Library" }).click();
		await page
			.locator('speeedy-file-uploader input[type="file"]')
			.setInputFiles(PDF);
		await expect(page.locator("text=added to your library")).toBeVisible({
			timeout: 90_000,
		});

		const result = await page.evaluate(async () => {
			const open = () =>
				new Promise<IDBDatabase>((resolve, reject) => {
					const req = indexedDB.open("speeedy-db");
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
			const all = <T>(db: IDBDatabase, store: string) =>
				new Promise<T[]>((resolve, reject) => {
					const req = db.transaction(store).objectStore(store).getAll();
					req.onsuccess = () => resolve(req.result as T[]);
					req.onerror = () => reject(req.error);
				});
			const db = await open();
			const docs = await all<{
				id: string;
				text: string;
				pages?: string[];
				original?: { kind: string; bytes: number };
			}>(db, "documents");
			const originals = await all<Blob>(db, "originals");
			const doc = docs[0];
			// Dev server serves the source modules, so the reader's own mapping can be checked.
			const { computePageStarts } = await import(
				/* @vite-ignore */ "/src/services/page-map.ts"
			);
			const { stripCitations } = await import(
				/* @vite-ignore */ "/src/utils/text-utils.ts"
			);
			const starts = computePageStarts(doc.pages ?? [], doc.text);
			const startsStripped = computePageStarts(
				doc.pages ?? [],
				doc.text,
				stripCitations,
			);
			return {
				version: db.version,
				pages: doc.pages?.length ?? 0,
				original: doc.original,
				storedBytes: originals[0]?.size ?? 0,
				storedType: originals[0]?.type ?? "",
				mapped: Array.isArray(starts),
				mappedStripped: Array.isArray(startsStripped),
			};
		});

		expect(result.version).toBe(3);
		expect(result.pages).toBeGreaterThan(10);
		expect(result.original?.kind).toBe("pdf");
		expect(result.storedType).toBe("application/pdf");
		expect(result.storedBytes).toBe(result.original?.bytes);
		expect(result.mapped).toBe(true);
		expect(result.mappedStripped).toBe(true);
	});

	test("an existing version-2 library keeps its documents after the upgrade", async ({
		page,
	}) => {
		// A same-origin page that does not start the app, to seed the old database.
		await page.goto("/robots.txt");
		await page.evaluate(
			() =>
				new Promise<void>((resolve, reject) => {
					const req = indexedDB.open("speeedy-db", 2);
					req.onupgradeneeded = () => {
						req.result.createObjectStore("profile");
						req.result.createObjectStore("documents", { keyPath: "id" });
					};
					req.onsuccess = () => {
						const db = req.result;
						const tx = db.transaction("documents", "readwrite");
						tx.objectStore("documents").put({
							id: "legacy",
							title: "Legacy book",
							text: "Words from before the upgrade.",
							wordCount: 5,
							savedAt: "2026-01-01T00:00:00.000Z",
							resumeWordIndex: 0,
							completionPercent: 0,
						});
						tx.oncomplete = () => {
							db.close();
							resolve();
						};
						tx.onerror = () => reject(tx.error);
					};
					req.onerror = () => reject(req.error);
				}),
		);

		await page.goto("/#/profile");
		await page.getByRole("button", { name: "Library" }).click();
		await expect(page.locator("text=Legacy book").first()).toBeVisible();

		const stores = await page.evaluate(
			() =>
				new Promise<{ version: number; names: string[] }>((resolve) => {
					const req = indexedDB.open("speeedy-db");
					req.onsuccess = () =>
						resolve({
							version: req.result.version,
							names: [...req.result.objectStoreNames],
						});
				}),
		);
		expect(stores.version).toBe(3);
		expect(stores.names).toEqual(
			expect.arrayContaining(["documents", "originals", "profile"]),
		);
	});

	test("the Original tab shows the PDF, marks the current word and resumes reading where you click", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.goto("/#/profile");
		await page.getByRole("button", { name: "Library" }).click();
		await page
			.locator('speeedy-file-uploader input[type="file"]')
			.setInputFiles(PDF);
		await expect(page.locator("text=added to your library")).toBeVisible({
			timeout: 90_000,
		});

		await page.goto("/#/reader");
		const originalTab = page.getByRole("tab", { name: "Original" });
		await expect(originalTab).toBeEnabled({ timeout: 15_000 });
		await page.keyboard.press("o");

		const label = page.getByTestId("original-page-label");
		// Page 1 of the fixture is the cover (no text), so the first word is on page 2.
		await expect(label).toHaveText(/Page 2 \/ \d+/, { timeout: 30_000 });
		await expect(page.locator("original-pdf-viewer canvas").first()).toBeVisible();
		await expect(page.locator(".current-word").first()).toBeVisible({
			timeout: 30_000,
		});

		// Click in the text block of page 3; the reader jumps there and switches back.
		const page3 = page.locator('.original-page[data-page="2"]');
		await page3.scrollIntoViewIfNeeded();
		await expect(page3.locator("canvas")).toBeVisible({ timeout: 30_000 });
		const box = await page3.boundingBox();
		if (!box) throw new Error("page 3 has no box");
		let jumped = false;
		for (const fy of [0.3, 0.4, 0.5, 0.6]) {
			await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * fy);
			if ((await page.getByRole("tab", { name: "Read" }).getAttribute("aria-selected")) === "true") {
				jumped = true;
				break;
			}
		}
		expect(jumped).toBe(true);

		// Opening the original again follows the new position to page 3.
		await page.keyboard.press("o");
		await expect(label).toHaveText(/Page 3 \/ \d+/, { timeout: 30_000 });
		await page.keyboard.press("Escape");
		await expect(page.getByRole("tab", { name: "Read" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("the pdf.js font files come from the app itself", async ({ request }) => {
		const res = await request.get("/pdfjs/standard_fonts/FoxitSans.pfb");
		expect(res.status()).toBe(200);
	});
});
