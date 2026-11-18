import type { TocEntry } from "../models/types.js";
import { type PdfOutlineSource, pdfToc } from "./toc.js";

/**
 * Reads the table of contents from a stored original PDF — for documents
 * imported before tables of contents were kept. [] when there is none.
 */
export async function readPdfTocFromBlob(
	original: Blob,
	pages: string[],
	text: string,
): Promise<TocEntry[]> {
	const pdfjs = await import("pdfjs-dist");
	const workerUrl = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
	const pdf = await pdfjs.getDocument({
		data: new Uint8Array(await original.arrayBuffer()),
	}).promise;
	try {
		return await pdfToc(pdf as unknown as PdfOutlineSource, pages, text);
	} finally {
		void pdf.destroy();
	}
}
