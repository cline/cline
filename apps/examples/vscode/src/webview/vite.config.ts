import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
		dedupe: ["react", "react-dom"],
	},
	base: "./",
	server: {
		cors: true,
		headers: {
			"Access-Control-Allow-Origin": "*",
		},
		hmr: {
			host: "localhost",
		},
	},
	build: {
		outDir: "../../dist/webview",
		emptyOutDir: true,
		cssMinify: "esbuild",
	},
});
