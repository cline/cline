/// <reference types="vitest/config" />

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./setupTests.js"],
	},
	build: {
		outDir: "build",
		rollupOptions: {
			output: {
				entryFileNames: `assets/[name].js`,
				chunkFileNames: `assets/[name].js`,
				assetFileNames: `assets/[name].[ext]`,
			},
		},
	},
	server: {
		hmr: {
			host: "localhost",
			protocol: "ws",
		},
		cors: {
			origin: "*",
			methods: "*",
			allowedHeaders: "*",
		},
	},
})
