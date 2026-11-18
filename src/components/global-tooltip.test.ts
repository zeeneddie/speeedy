import { afterEach, describe, expect, it } from "vitest";
import "./global-tooltip.js";

const boxAt = (left: number, top: number, width: number, height: number) => {
	const el = document.createElement("div");
	el.getBoundingClientRect = () =>
		({
			left,
			top,
			width,
			height,
			right: left + width,
			bottom: top + height,
			x: left,
			y: top,
		}) as DOMRect;
	return el;
};

describe("global-tooltip", () => {
	const width = window.innerWidth;
	afterEach(() => {
		window.innerWidth = width;
		document.body.innerHTML = "";
	});

	it("keeps a tip placed above an element inside the left edge of a narrow screen", () => {
		window.innerWidth = 360;
		const tip = document.createElement("global-tooltip");
		document.body.append(tip);
		window.dispatchEvent(
			new CustomEvent("speeedy:show-tooltip", {
				detail: {
					text: "Session 1",
					target: boxAt(36, 500, 8, 4),
					above: boxAt(0, 400, 360, 120),
				},
			}),
		);
		// Centred at 40px a 200px tip would start at -60px; it stays 12px from the edge.
		expect(tip.style.left).toBe(`${200 / 2 + 12}px`);
	});
});
