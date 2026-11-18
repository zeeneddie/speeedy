import { type IDBPDatabase, openDB } from "idb";
import type {
	DocSession,
	Mark,
	OriginalKind,
	OriginalRef,
	SavedDocument,
	TocEntry,
	UserProfile,
} from "../models/types.js";
import { DEFAULT_SETTINGS, getDefaultFontSize } from "./defaults.js";

const DB_NAME = "speeedy-db";
const DB_VERSION = 3;
const PROFILE_STORE = "profile";
const PROFILE_KEY = "user-profile";
const DOCS_STORE = "documents";
/** Original files (Blob) keyed by document id; kept apart so library listings stay light. */
const ORIGINALS_STORE = "originals";

const MAX_SAVED_DOCS = 20;

let dbInstance: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
	if (dbInstance) return dbInstance;
	dbInstance = await openDB(DB_NAME, DB_VERSION, {
		upgrade(db, oldVersion) {
			try {
				if (!db.objectStoreNames.contains(PROFILE_STORE)) {
					db.createObjectStore(PROFILE_STORE);
				}
				if (oldVersion < 2 && !db.objectStoreNames.contains(DOCS_STORE)) {
					db.createObjectStore(DOCS_STORE, { keyPath: "id" });
				}
				if (oldVersion < 3 && !db.objectStoreNames.contains(ORIGINALS_STORE)) {
					db.createObjectStore(ORIGINALS_STORE);
				}
			} catch (err) {
				console.error("[speeedy] IndexedDB upgrade failed:", err);
			}
		},
		blocked() {
			// Another tab holds an older DB version — the upgrade can't proceed until it closes.
			console.warn("[speeedy] Database upgrade blocked by another tab.");
		},
		blocking() {
			// This tab holds an old version and a newer tab needs to upgrade.
			// Close our connection so the other tab can proceed.
			dbInstance?.close();
			dbInstance = null;
		},
	});
	return dbInstance;
}

function createDefaultProfile(): UserProfile {
	return {
		id: crypto.randomUUID(),
		displayName: "Reader",
		avatarEmoji: "📚",
		avatarImage: null,
		createdAt: new Date().toISOString(),
		goals: { type: "words", target: 10000 },
		totalWordsRead: 0,
		totalTimeMs: 0,
		currentStreak: 0,
		bestStreak: 0,
		lastReadDate: null,
		sessions: [],
		settings: { ...DEFAULT_SETTINGS, fontSize: getDefaultFontSize() },
		baselineWpm: null,
		baselineComprehension: null,
		onboardingSeen: false,
	};
}

export async function loadProfile(): Promise<UserProfile> {
	const db = await getDb();
	const profile = await db.get(PROFILE_STORE, PROFILE_KEY);
	if (profile) return profile as UserProfile;
	const newProfile = createDefaultProfile();
	await db.put(PROFILE_STORE, newProfile, PROFILE_KEY);
	return newProfile;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
	const db = await getDb();
	await db.put(PROFILE_STORE, profile, PROFILE_KEY);
}

export async function exportProfile(): Promise<string> {
	const profile = await loadProfile();
	const json = JSON.stringify(profile);
	const bytes = new TextEncoder().encode(json);
	const compressed = await compressData(bytes);
	const arr = new Uint8Array(compressed);
	let binary = "";
	for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
	return btoa(binary);
}

export async function importProfile(encoded: string): Promise<UserProfile> {
	const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
	const decompressed = await decompressData(bytes);
	const json = new TextDecoder().decode(decompressed);
	const raw = JSON.parse(json);
	if (!isValidProfile(raw)) throw new Error("Invalid profile data.");
	const defaults = createDefaultProfile();
	const merged: UserProfile = {
		...defaults,
		...raw,
		settings: { ...DEFAULT_SETTINGS, ...raw.settings },
	};
	await saveProfile(merged);
	return merged;
}

function isValidProfile(obj: unknown): obj is UserProfile {
	if (!obj || typeof obj !== "object") return false;
	const p = obj as Record<string, unknown>;
	return (
		typeof p.id === "string" &&
		typeof p.displayName === "string" &&
		Array.isArray(p.sessions) &&
		typeof p.settings === "object" &&
		p.settings !== null
	);
}

async function compressData(data: Uint8Array): Promise<ArrayBuffer> {
	const stream = new CompressionStream("gzip");
	const writer = stream.writable.getWriter();
	await writer.write(data.buffer.slice(0) as ArrayBuffer);
	await writer.close();
	return new Response(stream.readable).arrayBuffer();
}

async function decompressData(data: Uint8Array): Promise<ArrayBuffer> {
	const stream = new DecompressionStream("gzip");
	const writer = stream.writable.getWriter();
	await writer.write(data.buffer.slice(0) as ArrayBuffer);
	await writer.close();
	return new Response(stream.readable).arrayBuffer();
}

/** True when a library record is complete enough to list, hash, or resume. */
export function isValidSavedDocument(value: unknown): value is SavedDocument {
	if (value === null || typeof value !== "object") return false;
	const doc = value as Record<string, unknown>;
	return (
		typeof doc.id === "string" &&
		doc.id.length > 0 &&
		typeof doc.title === "string" &&
		typeof doc.text === "string" &&
		typeof doc.savedAt === "string" &&
		typeof doc.wordCount === "number"
	);
}

/** Drop unreadable library rows (including null values) so they cannot crash save/load. */
async function purgeInvalidDocuments(db: IDBPDatabase): Promise<void> {
	try {
		const tx = db.transaction(DOCS_STORE, "readwrite");
		let cursor = await tx.store.openCursor();
		while (cursor) {
			if (!isValidSavedDocument(cursor.value)) {
				await cursor.delete();
			}
			cursor = await cursor.continue();
		}
		await tx.done;
	} catch (err) {
		console.error("[speeedy] Failed to repair document library:", err);
	}
}

async function readSavedDocuments(db: IDBPDatabase): Promise<SavedDocument[]> {
	await purgeInvalidDocuments(db);
	const raw = await db.getAll(DOCS_STORE);
	const docs = (Array.isArray(raw) ? raw : []).filter(isValidSavedDocument);
	return docs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getSavedDocuments(): Promise<SavedDocument[]> {
	try {
		const db = await getDb();
		return await readSavedDocuments(db);
	} catch (err) {
		console.error("[speeedy] Failed to load saved documents:", err);
		return [];
	}
}

async function hashContent(text: string): Promise<string> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Original-file kinds that can be stored, by MIME type. */
const ORIGINAL_KINDS: Record<string, OriginalKind> = {
	"application/pdf": "pdf",
};

function originalKindOf(file: Blob): OriginalKind | null {
	return ORIGINAL_KINDS[file.type] ?? null;
}

/** True when the browser reports room for `bytes` more (with 10% headroom), or cannot tell. */
async function hasRoomFor(bytes: number): Promise<boolean> {
	try {
		const estimate = await navigator.storage?.estimate?.();
		if (!estimate?.quota) return true;
		return estimate.quota - (estimate.usage ?? 0) > bytes * 1.1;
	} catch {
		return true;
	}
}

/**
 * Stores the original file for a document. Returns its metadata, or null when it
 * was not stored (unsupported kind, not enough room, or the write failed).
 */
async function storeOriginal(
	db: IDBPDatabase,
	docId: string,
	file: Blob,
): Promise<OriginalRef | null> {
	const kind = originalKindOf(file);
	if (!kind) return null;
	if (!(await hasRoomFor(file.size))) return null;
	try {
		await navigator.storage?.persist?.();
	} catch {
		/* best effort: persistence is a request, not a requirement */
	}
	try {
		await db.put(ORIGINALS_STORE, file, docId);
		return { kind, mime: file.type, bytes: file.size };
	} catch (err) {
		console.warn("[speeedy] Original file not stored:", err);
		return null;
	}
}

export interface SaveDocumentInput
	extends Omit<SavedDocument, "id" | "savedAt" | "original"> {
	/** Original file to keep next to the text (PDF only for now). */
	originalFile?: Blob;
}

/**
 * Saves a document, de-duplicating on its text. When `originalFile` is given and
 * can be stored, the result carries `original`; when it is given but could not be
 * stored, the result has no `original` and the caller can tell the user.
 */
export async function saveDocument(
	input: SaveDocumentInput,
): Promise<SavedDocument> {
	const { originalFile, ...doc } = input;
	const db = await getDb();
	const contentHash = await hashContent(doc.text);
	const all = await readSavedDocuments(db);

	for (const existing of all) {
		const existingHash =
			existing.contentHash ?? (await hashContent(existing.text));
		if (existingHash === contentHash) {
			const updated: SavedDocument = {
				...existing,
				savedAt: new Date().toISOString(),
			};
			if (!updated.pages && doc.pages) updated.pages = doc.pages;
			if (!updated.toc?.length && doc.toc?.length) updated.toc = doc.toc;
			if (!updated.original && originalFile) {
				const original = await storeOriginal(db, existing.id, originalFile);
				if (original) updated.original = original;
			}
			await db.put(DOCS_STORE, updated);
			return updated;
		}
	}

	const saved: SavedDocument = {
		...doc,
		id: crypto.randomUUID(),
		savedAt: new Date().toISOString(),
		contentHash,
	};
	if (originalFile) {
		const original = await storeOriginal(db, saved.id, originalFile);
		if (original) saved.original = original;
	}
	await db.put(DOCS_STORE, saved);
	await pruneDocuments(db);
	return saved;
}

/** One library document by id, or null when it does not exist (or cannot be read). */
export async function getSavedDocument(
	id: string,
): Promise<SavedDocument | null> {
	try {
		const db = await getDb();
		const doc = await db.get(DOCS_STORE, id);
		return isValidSavedDocument(doc) ? doc : null;
	} catch (err) {
		console.error("[speeedy] Failed to load document:", err);
		return null;
	}
}

/** The stored original file of a document, or null when there is none. */
export async function getOriginal(docId: string): Promise<Blob | null> {
	try {
		const db = await getDb();
		const blob = await db.get(ORIGINALS_STORE, docId);
		return blob instanceof Blob ? blob : null;
	} catch (err) {
		console.error("[speeedy] Failed to load original file:", err);
		return null;
	}
}

/**
 * Reads, changes and writes one document in a single transaction, so concurrent
 * changes (progress, marks, sessions) are applied one after another instead of
 * overwriting each other.
 */
async function updateDoc(
	id: string,
	change: (doc: SavedDocument) => SavedDocument,
): Promise<void> {
	const db = await getDb();
	const tx = db.transaction(DOCS_STORE, "readwrite");
	const doc = (await tx.store.get(id)) as SavedDocument | undefined;
	if (doc) await tx.store.put(change(doc));
	await tx.done;
}

export async function updateDocumentProgress(
	id: string,
	resumeWordIndex: number,
	completionPercent: number,
): Promise<void> {
	await updateDoc(id, (doc) => ({
		...doc,
		resumeWordIndex,
		completionPercent,
	}));
}

/** Adds a finished reading session to a document. */
export async function appendDocumentSession(
	id: string,
	session: DocSession,
): Promise<void> {
	await updateDoc(id, (doc) => ({
		...doc,
		sessions: [...(doc.sessions ?? []), session],
	}));
}

/** Stores the table of contents of a document ([] = looked, none found). */
export async function updateDocumentToc(
	id: string,
	toc: TocEntry[],
): Promise<void> {
	await updateDoc(id, (doc) => ({ ...doc, toc }));
}

/** Replaces the marks of a document. */
export async function updateDocumentMarks(
	id: string,
	marks: Mark[],
): Promise<void> {
	await updateDoc(id, (doc) => ({ ...doc, marks }));
}

export async function deleteSavedDocument(id: string): Promise<void> {
	const db = await getDb();
	await db.delete(DOCS_STORE, id);
	await db.delete(ORIGINALS_STORE, id);
}

async function pruneDocuments(db: IDBPDatabase): Promise<void> {
	const all = await readSavedDocuments(db);
	if (all.length > MAX_SAVED_DOCS) {
		// Marks are the reader's own work: documents that have them are never pruned silently.
		const toDelete = all
			.slice(MAX_SAVED_DOCS)
			.filter((doc) => !doc.marks?.length);
		for (const doc of toDelete) {
			await db.delete(DOCS_STORE, doc.id);
			await db.delete(ORIGINALS_STORE, doc.id);
		}
	}
}
