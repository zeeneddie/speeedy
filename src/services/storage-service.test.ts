import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedDocument } from "../models/types.js";

const { store, originals } = vi.hoisted(() => ({
	/** The "documents" store. */
	store: new Map<IDBValidKey, unknown>(),
	/** The "originals" store. */
	originals: new Map<IDBValidKey, unknown>(),
}));

vi.mock("idb", () => {
	const pick = (storeName: string) =>
		storeName === "originals" ? originals : store;
	return {
		openDB: vi.fn(async () => ({
			getAll: async (storeName: string) => [...pick(storeName).values()],
			put: async (storeName: string, value: unknown, key?: IDBValidKey) => {
				pick(storeName).set(key ?? (value as { id: string }).id, value);
			},
			get: async (storeName: string, key: IDBValidKey) =>
				pick(storeName).get(key),
			delete: async (storeName: string, key: IDBValidKey) => {
				pick(storeName).delete(key);
			},
			transaction: () => {
				const keys = [...store.keys()];
				let index = 0;
				const nextCursor = () => {
					if (index >= keys.length) return null;
					const key = keys[index++];
					return {
						get value() {
							return store.get(key) ?? null;
						},
						delete: async () => {
							store.delete(key);
						},
						continue: async () => nextCursor(),
					};
				};
				return {
					store: {
						openCursor: async () => nextCursor(),
						get: async (key: IDBValidKey) => store.get(key),
						put: async (value: { id: string }) => {
							store.set(value.id, value);
						},
					},
					done: Promise.resolve(),
				};
			},
		})),
	};
});

function makeDoc(
	overrides: Partial<SavedDocument> & Pick<SavedDocument, "id" | "text">,
): SavedDocument {
	return {
		title: "A book",
		wordCount: 2,
		savedAt: "2026-01-01T00:00:00.000Z",
		resumeWordIndex: 0,
		completionPercent: 0,
		...overrides,
	};
}

describe("storage-service documents", () => {
	beforeEach(async () => {
		store.clear();
		originals.clear();
		vi.resetModules();
		vi.unstubAllGlobals();
	});

	it("treats null and incomplete records as invalid", async () => {
		const { isValidSavedDocument } = await import("./storage-service.js");
		expect(isValidSavedDocument(null)).toBe(false);
		expect(isValidSavedDocument(undefined)).toBe(false);
		expect(isValidSavedDocument({ id: "x" })).toBe(false);
		expect(
			isValidSavedDocument(
				makeDoc({ id: "ok", text: "Hello world", title: "Ok" }),
			),
		).toBe(true);
	});

	it("loads the library even when IndexedDB returns a null record", async () => {
		store.set("ghost", null);
		store.set(
			"ok",
			makeDoc({
				id: "ok",
				text: "Hello world",
				savedAt: "2026-02-01T00:00:00.000Z",
			}),
		);

		const { getSavedDocuments } = await import("./storage-service.js");
		const docs = await getSavedDocuments();

		expect(docs).toHaveLength(1);
		expect(docs[0].id).toBe("ok");
		expect(store.has("ghost")).toBe(false);
		expect(store.has("ok")).toBe(true);
	});

	it("returns an empty library when the only record is null", async () => {
		store.set("ghost", null);

		const { getSavedDocuments } = await import("./storage-service.js");
		await expect(getSavedDocuments()).resolves.toEqual([]);
		expect(store.size).toBe(0);
	});

	it("saves a new document when a null library record would previously crash", async () => {
		store.set("ghost", null);
		store.set("broken", { id: "broken" });

		const { saveDocument, getSavedDocuments } = await import(
			"./storage-service.js"
		);
		const saved = await saveDocument({
			title: "Pasted Text",
			text: "Fresh text to read",
			wordCount: 4,
			resumeWordIndex: 0,
			completionPercent: 0,
		});

		expect(saved.id).toBeTruthy();
		expect(saved.contentHash).toMatch(/^[a-f0-9]{64}$/);
		const docs = await getSavedDocuments();
		expect(docs.some((d) => d.id === saved.id)).toBe(true);
		expect(store.has("ghost")).toBe(false);
		expect(store.has("broken")).toBe(false);
	});

	it("still dedupes against a valid existing document", async () => {
		store.set(
			"old",
			makeDoc({
				id: "old",
				text: "Same text",
				contentHash: undefined,
			}),
		);

		const { saveDocument } = await import("./storage-service.js");
		const saved = await saveDocument({
			title: "Copy",
			text: "Same text",
			wordCount: 2,
			resumeWordIndex: 0,
			completionPercent: 0,
		});

		expect(saved.id).toBe("old");
	});

	describe("original files", () => {
		const pdf = () => new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
		const input = (text: string) => ({
			title: "Book",
			text,
			wordCount: 2,
			resumeWordIndex: 0,
			completionPercent: 0,
			pages: [text],
		});

		it("stores the original next to the document and returns it", async () => {
			const { saveDocument, getOriginal } = await import(
				"./storage-service.js"
			);
			const file = pdf();
			const saved = await saveDocument({
				...input("Page one"),
				originalFile: file,
			});

			expect(saved.original).toEqual({
				kind: "pdf",
				mime: "application/pdf",
				bytes: file.size,
			});
			expect(saved.pages).toEqual(["Page one"]);
			expect((store.get(saved.id) as SavedDocument).original?.kind).toBe("pdf");
			expect(store.get(saved.id)).not.toHaveProperty("originalFile");
			await expect(getOriginal(saved.id)).resolves.toBe(file);
		});

		it("saves the text without the original when storage is full", async () => {
			vi.stubGlobal("navigator", {
				storage: {
					estimate: async () => ({ quota: 100, usage: 99 }),
				},
			});
			const { saveDocument, getOriginal } = await import(
				"./storage-service.js"
			);
			const saved = await saveDocument({
				...input("Full disk"),
				originalFile: pdf(),
			});

			expect(saved.original).toBeUndefined();
			expect(store.has(saved.id)).toBe(true);
			await expect(getOriginal(saved.id)).resolves.toBeNull();
		});

		it("does not store originals of unsupported kinds", async () => {
			const { saveDocument } = await import("./storage-service.js");
			const saved = await saveDocument({
				...input("Plain"),
				originalFile: new Blob(["x"], { type: "text/plain" }),
			});

			expect(saved.original).toBeUndefined();
			expect(originals.size).toBe(0);
		});

		it("attaches the original to an existing duplicate that had none", async () => {
			store.set("old", makeDoc({ id: "old", text: "Same text" }));
			const { saveDocument } = await import("./storage-service.js");
			const saved = await saveDocument({
				...input("Same text"),
				originalFile: pdf(),
			});

			expect(saved.id).toBe("old");
			expect(saved.original?.kind).toBe("pdf");
			expect(saved.pages).toEqual(["Same text"]);
			expect(originals.has("old")).toBe(true);
		});

		it("removes the original when the document is deleted", async () => {
			const { saveDocument, deleteSavedDocument } = await import(
				"./storage-service.js"
			);
			const saved = await saveDocument({
				...input("Delete me"),
				originalFile: pdf(),
			});
			expect(originals.has(saved.id)).toBe(true);

			await deleteSavedDocument(saved.id);

			expect(store.has(saved.id)).toBe(false);
			expect(originals.has(saved.id)).toBe(false);
		});

		it("removes originals of documents pruned beyond the library limit", async () => {
			for (let i = 0; i < 20; i++) {
				store.set(
					`d${i}`,
					makeDoc({
						id: `d${i}`,
						text: `Text ${i}`,
						savedAt: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
					}),
				);
			}
			originals.set("d0", pdf());

			const { saveDocument } = await import("./storage-service.js");
			await saveDocument({ ...input("Newest"), originalFile: pdf() });

			expect(store.has("d0")).toBe(false);
			expect(originals.has("d0")).toBe(false);
			expect(store.size).toBe(20);
		});
	});

	describe("marks", () => {
		const mark = {
			id: "m1",
			createdAt: "2026-11-18T00:00:00.000Z",
			page: 1,
			startWord: 0,
			endWord: 2,
			prep: "plain" as const,
			quote: "Hello there world.",
		};

		it("stores marks on the document", async () => {
			store.set("doc", makeDoc({ id: "doc", text: "Hello there world." }));
			const { updateDocumentMarks, getSavedDocument } = await import(
				"./storage-service.js"
			);
			await updateDocumentMarks("doc", [mark]);
			expect((await getSavedDocument("doc"))?.marks).toEqual([mark]);
		});

		it("never prunes a document that has marks", async () => {
			for (let i = 0; i < 20; i++) {
				store.set(
					`d${i}`,
					makeDoc({
						id: `d${i}`,
						text: `Text ${i}`,
						savedAt: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
						...(i === 0 ? { marks: [mark] } : {}),
					}),
				);
			}
			const { saveDocument } = await import("./storage-service.js");
			await saveDocument({
				title: "Newest",
				text: "Newest text",
				wordCount: 2,
				resumeWordIndex: 0,
				completionPercent: 0,
			});

			expect(store.has("d0")).toBe(true);
			expect(store.size).toBe(21);
		});
	});
});
