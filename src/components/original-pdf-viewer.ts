import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { pageForWord } from "../services/page-map.js";
import {
	alignTokensToItems,
	type PdfRect,
	type PdfTextItem,
	tokenAtPoint,
	toPdfTextItem,
} from "../services/pdf-word-geometry.js";

export type OriginalHighlight = "word" | "page" | "off";

/** Fired when the reader clicks a word in the original; `wordIndex` is in the reader's token stream. */
export interface OriginalWordClickDetail {
	wordIndex: number;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const PAGE_GAP_PX = 16;

interface RenderedPage {
	/** Null until the page object has loaded. */
	viewport: PageViewport | null;
	/** Rectangles per token of this page (index = word index − page start), or null when not computed. */
	rects: (PdfRect[] | null)[] | null;
	overlay: HTMLDivElement;
}

/**
 * Shows the original PDF of the document being read, follows the reader's
 * current word and turns a click on a word into a jump in the reader.
 * Pages are drawn only when they scroll into view.
 */
@customElement("original-pdf-viewer")
export class OriginalPdfViewer extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ attribute: false }) original: Blob | null = null;
	/** Word index at which each page starts (see `computePageStarts`), or null when pages could not be mapped. */
	@property({ attribute: false }) pageStarts: number[] | null = null;
	/** The reader's tokens (text only), whole document, in reading order. */
	@property({ attribute: false }) tokens: string[] = [];
	@property({ type: Number }) currentWord = 0;
	@property({ type: Boolean }) follow = true;
	@property({ type: String }) highlight: OriginalHighlight = "word";
	@property({ type: Boolean }) clickToResume = true;

	@state() private status: "loading" | "ready" | "error" = "loading";
	@state() private zoomIndex = ZOOM_STEPS.indexOf(1);
	@state() private pageCount = 0;

	@query(".original-scroll") private scroller!: HTMLDivElement;

	private pdf: PDFDocumentProxy | null = null;
	private baseSize = { width: 612, height: 792 };
	private wrappers: HTMLDivElement[] = [];
	private rendered = new Map<number, RenderedPage>();
	private observer: IntersectionObserver | null = null;
	private loadToken = 0;

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.teardown();
	}

	protected override async updated(
		changed: Map<string, unknown>,
	): Promise<void> {
		if (changed.has("original")) {
			await this.load();
			return;
		}
		if (changed.has("zoomIndex") && this.pdf) {
			this.layoutPages();
			this.scrollToCurrent("auto");
			return;
		}
		if (
			changed.has("currentWord") ||
			changed.has("highlight") ||
			changed.has("pageStarts")
		) {
			this.paintHighlights();
			if (this.follow && changed.has("currentWord")) this.scrollToCurrent();
		}
	}

	private teardown(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.rendered.clear();
		this.wrappers = [];
		void this.pdf?.destroy();
		this.pdf = null;
	}

	private async load(): Promise<void> {
		const token = ++this.loadToken;
		this.teardown();
		if (!this.original) return;
		this.status = "loading";
		try {
			const pdfjs = await import("pdfjs-dist");
			const workerUrl = await import(
				"pdfjs-dist/legacy/build/pdf.worker.mjs?url"
			);
			pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
			const base = import.meta.env.BASE_URL;
			const pdf = await pdfjs.getDocument({
				data: new Uint8Array(await this.original.arrayBuffer()),
				cMapUrl: `${base}pdfjs/cmaps/`,
				cMapPacked: true,
				standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
			}).promise;
			if (token !== this.loadToken) {
				void pdf.destroy();
				return;
			}
			this.pdf = pdf;
			const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
			this.baseSize = { width: first.width, height: first.height };
			this.pageCount = pdf.numPages;
			this.status = "ready";
			await this.updateComplete;
			this.layoutPages();
			this.scrollToCurrent("auto");
		} catch (err) {
			console.error("[speeedy] Could not open the original PDF:", err);
			if (token === this.loadToken) this.status = "error";
		}
	}

	private get scale(): number {
		const available = Math.max((this.scroller?.clientWidth ?? 800) - 32, 200);
		return (available / this.baseSize.width) * ZOOM_STEPS[this.zoomIndex];
	}

	/** (Re)creates one placeholder per page and draws pages as they scroll into view. */
	private layoutPages(): void {
		if (!this.pdf || !this.scroller) return;
		this.observer?.disconnect();
		this.rendered.clear();
		const container =
			this.scroller.querySelector<HTMLDivElement>(".original-pages");
		if (!container) return;
		container.replaceChildren();
		this.wrappers = [];
		const scale = this.scale;
		for (let i = 0; i < this.pageCount; i++) {
			const wrapper = document.createElement("div");
			wrapper.className =
				"original-page relative mx-auto bg-white shadow rounded-sm";
			wrapper.dataset.page = String(i);
			wrapper.style.width = `${this.baseSize.width * scale}px`;
			wrapper.style.height = `${this.baseSize.height * scale}px`;
			wrapper.style.marginBottom = `${PAGE_GAP_PX}px`;
			container.append(wrapper);
			this.wrappers.push(wrapper);
		}
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const index = Number((entry.target as HTMLElement).dataset.page);
					if (!this.rendered.has(index)) void this.renderPage(index);
				}
			},
			{ root: this.scroller, rootMargin: "100% 0px" },
		);
		for (const wrapper of this.wrappers) this.observer.observe(wrapper);
	}

	private async renderPage(index: number): Promise<void> {
		const pdf = this.pdf;
		const wrapper = this.wrappers[index];
		if (!pdf || !wrapper) return;
		const overlay = document.createElement("div");
		overlay.className = "absolute inset-0";
		// Claim the slot before awaiting, so a second intersection does not draw it twice.
		const pending = pdf.getPage(index + 1);
		const entry: RenderedPage = { viewport: null, rects: null, overlay };
		this.rendered.set(index, entry);
		const page: PDFPageProxy = await pending;
		if (this.pdf !== pdf) return;
		entry.viewport = page.getViewport({ scale: this.scale });

		const viewport = entry.viewport;
		wrapper.style.width = `${viewport.width}px`;
		wrapper.style.height = `${viewport.height}px`;
		const ratio = window.devicePixelRatio || 1;
		const canvas = document.createElement("canvas");
		canvas.width = Math.floor(viewport.width * ratio);
		canvas.height = Math.floor(viewport.height * ratio);
		canvas.style.width = `${viewport.width}px`;
		canvas.style.height = `${viewport.height}px`;
		canvas.className = "block";
		wrapper.replaceChildren(canvas, overlay);
		if (this.clickToResume) {
			overlay.style.cursor = "pointer";
			overlay.addEventListener("click", (e) => this.onPageClick(index, e));
		}

		await page.render({
			canvas,
			viewport,
			transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
		}).promise;
		if (this.pdf !== pdf) return;

		const pageTokens = this.tokensOfPage(index);
		if (pageTokens) {
			const content = await page.getTextContent();
			const items: PdfTextItem[] = [];
			for (const item of content.items) {
				if ("str" in item && item.str) items.push(toPdfTextItem(item));
			}
			entry.rects = alignTokensToItems(pageTokens, items);
		}
		this.paintHighlights();
	}

	private tokensOfPage(index: number): string[] | null {
		const starts = this.pageStarts;
		if (!starts || index >= starts.length) return null;
		const end =
			index + 1 < starts.length ? starts[index + 1] : this.tokens.length;
		return this.tokens.slice(starts[index], end);
	}

	private get currentPage(): number | null {
		return this.pageStarts
			? pageForWord(this.pageStarts, this.currentWord)
			: null;
	}

	private currentRects(): { page: number; rects: PdfRect[] } | null {
		const page = this.currentPage;
		if (page === null || !this.pageStarts) return null;
		const rects =
			this.rendered.get(page)?.rects?.[
				this.currentWord - this.pageStarts[page]
			];
		return rects ? { page, rects } : null;
	}

	/** Marks the current word, or only its page when the word has no position (never a wrong word). */
	private paintHighlights(): void {
		for (const [, entry] of this.rendered) {
			for (const el of entry.overlay.querySelectorAll(".current-word"))
				el.remove();
		}
		for (const wrapper of this.wrappers)
			wrapper.classList.remove("ring-2", "ring-primary/40");
		if (this.highlight === "off") return;
		const page = this.currentPage;
		if (page === null) return;
		const word = this.highlight === "word" ? this.currentRects() : null;
		if (!word) {
			this.wrappers[page]?.classList.add("ring-2", "ring-primary/40");
			return;
		}
		const viewport = this.rendered.get(word.page)?.viewport;
		const overlay = this.rendered.get(word.page)?.overlay;
		if (!viewport || !overlay) return;
		for (const rect of word.rects) {
			const [x0, y0, x1, y1] = viewport.convertToViewportRectangle([
				rect.x0,
				rect.y0,
				rect.x1,
				rect.y1,
			]);
			const box = document.createElement("div");
			box.className =
				"current-word absolute rounded-sm bg-primary/30 pointer-events-none";
			box.style.left = `${Math.min(x0, x1)}px`;
			box.style.top = `${Math.min(y0, y1)}px`;
			box.style.width = `${Math.abs(x1 - x0)}px`;
			box.style.height = `${Math.abs(y1 - y0)}px`;
			overlay.append(box);
		}
	}

	private scrollToCurrent(behavior: ScrollBehavior = "smooth"): void {
		const page = this.currentPage;
		if (page === null || !this.scroller) return;
		const wrapper = this.wrappers[page];
		if (!wrapper) return;
		let top = wrapper.offsetTop - PAGE_GAP_PX;
		const word = this.currentRects();
		const viewport = word ? this.rendered.get(word.page)?.viewport : null;
		if (word && viewport) {
			const [, y] = viewport.convertToViewportPoint(
				word.rects[0].x0,
				word.rects[0].y1,
			);
			top = wrapper.offsetTop + y - this.scroller.clientHeight / 3;
		}
		this.scroller.scrollTo({ top: Math.max(0, top), behavior });
	}

	private onPageClick(index: number, e: MouseEvent): void {
		const entry = this.rendered.get(index);
		const starts = this.pageStarts;
		if (!entry?.rects || !entry.viewport || !starts) return;
		const bounds = entry.overlay.getBoundingClientRect();
		const [x, y] = entry.viewport.convertToPdfPoint(
			e.clientX - bounds.left,
			e.clientY - bounds.top,
		);
		const hit = tokenAtPoint(entry.rects, x, y);
		if (hit < 0) return;
		this.dispatchEvent(
			new CustomEvent<OriginalWordClickDetail>("original-word-click", {
				detail: { wordIndex: starts[index] + hit },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private zoom(step: number): void {
		this.zoomIndex = Math.min(
			ZOOM_STEPS.length - 1,
			Math.max(0, this.zoomIndex + step),
		);
	}

	override render() {
		const page = this.currentPage;
		return html`
			<div class="flex flex-col h-full w-full">
				<div class="flex items-center justify-between gap-2 px-4 py-2 border-b border-base-200 text-sm shrink-0">
					<span class="text-ui-muted font-mono" data-testid="original-page-label">
						${
							this.status === "ready"
								? page !== null
									? `Page ${page + 1} / ${this.pageCount}`
									: `${this.pageCount} pages`
								: ""
						}
					</span>
					<div class="flex items-center gap-1">
						<button type="button" class="btn btn-ghost btn-sm" @click=${() => this.scrollToCurrent()} ?disabled=${page === null}>
							Back to my place
						</button>
						<button type="button" class="btn btn-ghost btn-sm btn-square" aria-label="Zoom out" @click=${() => this.zoom(-1)}>−</button>
						<span class="w-12 text-center font-mono text-xs">${Math.round(ZOOM_STEPS[this.zoomIndex] * 100)}%</span>
						<button type="button" class="btn btn-ghost btn-sm btn-square" aria-label="Zoom in" @click=${() => this.zoom(1)}>+</button>
					</div>
				</div>
				${
					this.status === "ready" && !this.pageStarts
						? html`<p class="px-4 py-2 text-xs text-ui-muted bg-base-200/50">
								The pages of this document could not be matched to the text, so the original does not follow your reading.
							</p>`
						: nothing
				}
				<div class="original-scroll flex-1 overflow-auto bg-base-200/60 py-4">
					${
						this.status === "loading"
							? html`<p class="text-center text-ui-muted py-16">Opening the original…</p>`
							: this.status === "error"
								? html`<p class="text-center text-error py-16">The original could not be opened.</p>`
								: nothing
					}
					<div class="original-pages"></div>
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"original-pdf-viewer": OriginalPdfViewer;
	}
}
