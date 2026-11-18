import type { ReadingSummary, SessionPiece } from "../services/session-view.js";

/**
 * Alternating session tints. Both reach at least 3:1 (WCAG 1.4.11) against
 * base-100 and base-200 in the light and the dark theme: the first mixes info
 * towards the text colour, the second towards info-content.
 */
export const SESSION_TINTS = [
	"bg-[color-mix(in_oklch,var(--color-info)_35%,var(--color-base-content))]",
	"bg-[color-mix(in_oklch,var(--color-info)_65%,var(--color-info-content))]",
] as const;

/** A pointer this close (px) to a piece counts as on it: thin pieces are hard to hit. */
const PIECE_SLOP_PX = 8;

/**
 * Index of the piece under `x` (px from the left of a band `width` px wide).
 * Later sessions are drawn on top, so the last piece under the pointer wins;
 * off every piece, the nearest one within {@link PIECE_SLOP_PX}. -1 for none.
 */
export function pieceAt(
	pieces: SessionPiece[],
	x: number,
	width: number,
): number {
	let best = -1;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = pieces.length - 1; i >= 0; i--) {
		const left = pieces[i].startFrac * width;
		// Pieces are drawn at least 2px wide.
		const right = Math.max(pieces[i].endFrac * width, left + 2);
		if (x >= left && x < right) return i;
		const dist = x < left ? left - x : x - right;
		if (dist < bestDist) {
			best = i;
			bestDist = dist;
		}
	}
	return bestDist <= PIECE_SLOP_PX ? best : -1;
}

/** Text alternative of the band, e.g. "2 sessions, 34% read". */
export function sessionBandLabel(summary: ReadingSummary): string {
	const n = summary.sessionCount;
	return `${n === 1 ? "1 session" : `${n} sessions`}, ${Math.round(summary.readRatio * 100)}% read`;
}

/**
 * The session line in the global tooltip. The tooltip is position: fixed, so it
 * is hidden on any scroll instead of staying behind at the old place.
 */
export class SessionTip {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private open = false;

	/**
	 * Shows the line of the piece under the pointer of `e` (its currentTarget is
	 * the band), or hides the tip when there is none. Touch and pen taps show it
	 * for 3 s. With `above`, the tip sits above that element instead of the piece.
	 */
	showAt(
		e: Pick<PointerEvent, "currentTarget" | "clientX" | "pointerType">,
		pieces: SessionPiece[],
		lines: string[],
		above?: HTMLElement | null,
	): void {
		const band = e.currentTarget as HTMLElement;
		const rect = band.getBoundingClientRect();
		const i = pieceAt(pieces, e.clientX - rect.left, rect.width);
		const target = band.querySelector<HTMLElement>(`[data-piece="${i}"]`);
		if (i < 0 || !target) {
			this.hide();
			return;
		}
		window.dispatchEvent(
			new CustomEvent("speeedy:show-tooltip", {
				detail: {
					text: lines[pieces[i].sessionIndex - 1],
					target,
					above: above ?? undefined,
				},
			}),
		);
		if (!this.open) {
			window.addEventListener("scroll", this.hide, {
				capture: true,
				passive: true,
			});
			this.open = true;
		}
		if (this.timer) clearTimeout(this.timer);
		this.timer = e.pointerType === "mouse" ? null : setTimeout(this.hide, 3000);
	}

	hide = (): void => {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.open) {
			window.removeEventListener("scroll", this.hide, { capture: true });
			this.open = false;
		}
		window.dispatchEvent(new CustomEvent("speeedy:hide-tooltip"));
	};
}
