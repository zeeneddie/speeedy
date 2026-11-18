import { describe, expect, it } from "vitest";
import type { SessionPiece } from "../services/session-view.js";
import { pieceAt, SessionTip } from "./session-band.js";

const piece = (
	sessionIndex: number,
	startFrac: number,
	endFrac: number,
): SessionPiece => ({
	sessionIndex,
	tint: ((sessionIndex - 1) % 2) as 0 | 1,
	startFrac,
	endFrac,
});

describe("pieceAt", () => {
	// Band of 200px: session 1 at 0–40px, session 2 at 100–102px (a thin block).
	const pieces = [piece(1, 0, 0.2), piece(2, 0.5, 0.51)];

	it("finds the piece under the pointer, the later one where they overlap", () => {
		expect(pieceAt(pieces, 20, 200)).toBe(0);
		expect(pieceAt(pieces, 101, 200)).toBe(1);
		const overlap = [piece(1, 0, 1), piece(2, 0.4, 0.6)];
		expect(pieceAt(overlap, 100, 200)).toBe(1);
		expect(pieceAt(overlap, 20, 200)).toBe(0);
	});

	it("takes the nearest piece within 8px, and none further away", () => {
		expect(pieceAt(pieces, 94, 200)).toBe(1); // 6px left of session 2
		expect(pieceAt(pieces, 110, 200)).toBe(1); // 8px right of its end
		expect(pieceAt(pieces, 47, 200)).toBe(0); // 7px right of session 1
		expect(pieceAt(pieces, 70, 200)).toBe(-1);
		expect(pieceAt(pieces, 111, 200)).toBe(-1);
		expect(pieceAt([], 10, 200)).toBe(-1);
	});
});

describe("SessionTip", () => {
	it("hides the tooltip on scroll and stops listening once hidden", () => {
		const band = document.createElement("div");
		band.innerHTML = '<div data-piece="0"></div>';
		band.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
		document.body.appendChild(band);
		let hides = 0;
		const onHide = () => hides++;
		window.addEventListener("speeedy:hide-tooltip", onHide);
		const tip = new SessionTip();
		tip.showAt(
			{ currentTarget: band, clientX: 10, pointerType: "mouse" },
			[piece(1, 0, 0.5)],
			["Session 1"],
		);
		document.body.dispatchEvent(new Event("scroll")); // scroll does not bubble: caught in the capture phase
		expect(hides).toBe(1);
		document.body.dispatchEvent(new Event("scroll"));
		expect(hides).toBe(1);
		window.removeEventListener("speeedy:hide-tooltip", onHide);
		band.remove();
	});
});
