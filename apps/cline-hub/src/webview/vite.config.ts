import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const mermaidChunkGroups = [
	{
		name: "mermaid-parser",
		maxSize: 450_000,
		test: /node_modules[\\/](?:\.bun[\\/])?@mermaid-js[+]parser/,
	},
	{
		name: "mermaid-langium",
		test: /node_modules[\\/](?:\.bun[\\/])?langium/,
	},
	{
		name: "mermaid-layout",
		maxSize: 450_000,
		test: /node_modules[\\/](?:\.bun[\\/])?(?:cytoscape|cytoscape-cose-bilkent|dagre|elkjs)/,
	},
	{
		name: "mermaid-markup",
		test: /node_modules[\\/](?:\.bun[\\/])?(?:katex|dompurify)/,
	},
];

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
		chunkSizeWarningLimit: 600,
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: mermaidChunkGroups,
				},
			},
		},
	},
});
