import { join } from "node:path";
import { expect, test } from "@playwright/test";

const PDF = join(
	import.meta.dirname,
	"../test-fixtures/01-11-2020-212827The 7 Habits of Highly Effective People.pdf",
);

test.describe("Marks", () => {
	test("M marks the current sentence; the mark survives a reload, shows in the original and can be removed", async ({
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
		await expect(page.getByRole("tab", { name: "Original" })).toBeEnabled({
			timeout: 15_000,
		});

		await page.keyboard.press("m");
		await expect(page.getByRole("status")).toContainText("Sentence marked");
		const marksButton = page.getByRole("button", { name: /Marks \(1\)/ });
		await expect(marksButton).toBeVisible();
		await expect(page.locator(".mark-tick")).toHaveCount(1);

		await page.reload();
		await expect(marksButton).toBeVisible({ timeout: 15_000 });

		await marksButton.click();
		const item = page.getByTestId("mark-item");
		await expect(item).toHaveCount(1);
		await expect(item).toContainText("Page 2");
		await item.getByRole("button", { name: "Show in original" }).click();
		await expect(page.locator(".marked-word").first()).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.locator(".mark-dot")).toHaveCount(1);

		await page.keyboard.press("Escape");
		await page.keyboard.press("m");
		await expect(page.getByRole("status")).toContainText("Mark removed");
		await expect(page.getByRole("button", { name: /Marks \(/ })).toHaveCount(0);
	});
});
