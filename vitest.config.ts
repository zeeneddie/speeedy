import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	oxc: {},
	resolve: {
		alias: {
			// The app bundles mammoth's browser build (reads an ArrayBuffer); tests use the same one.
			mammoth: fileURLToPath(
				new URL("./node_modules/mammoth/mammoth.browser.js", import.meta.url),
			),
		},
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
	},
});
