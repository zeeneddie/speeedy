import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Serves pdf.js character maps and standard fonts from our own origin
 * (/pdfjs/cmaps/, /pdfjs/standard_fonts/) in dev and copies them into the
 * build, so rendering PDFs never fetches anything from a CDN.
 */
function pdfjsAssets(): Plugin {
	const root = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
	const dirs = ["cmaps", "standard_fonts"];
	return {
		name: "pdfjs-assets",
		configureServer(server) {
			server.middlewares.use("/pdfjs", (req, res, next) => {
				const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
				const dir = rel.split("/")[0];
				const file = normalize(join(root, rel));
				if (!dirs.includes(dir) || !file.startsWith(join(root, dir) + sep) || !existsSync(file)) {
					next();
					return;
				}
				res.setHeader("Content-Type", "application/octet-stream");
				createReadStream(file).pipe(res);
			});
		},
		generateBundle() {
			for (const dir of dirs) {
				for (const name of readdirSync(join(root, dir))) {
					this.emitFile({
						type: "asset",
						fileName: `pdfjs/${dir}/${name}`,
						source: readFileSync(join(root, dir, name)),
					});
				}
			}
		},
	};
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		pdfjsAssets(),
		VitePWA({
			registerType: "autoUpdate",
			// Don't inject the manifest — we manage public/manifest.webmanifest ourselves
			manifest: false,
			workbox: {
				// Cache app shell and all static assets
				globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
				// Large PDF/DOCX/EPUB chunks are lazy-loaded; cache them separately
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
			},
		}),
	],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("pdfjs-dist")) return "pdf";
					if (id.includes("mammoth")) return "mammoth";
					if (id.includes("jszip")) return "jszip";
					if (id.includes("html-to-image")) return "html-to-image";
					if (id.includes("node_modules/lit") || id.includes("node_modules/@lit")) return "lit";
				},
			},
		},
		chunkSizeWarningLimit: 500,
	},
});
