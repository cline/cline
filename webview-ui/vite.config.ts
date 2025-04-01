/// <reference types="vitest/config" />

import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"

export default defineConfig({
	plugins: [react(), tailwindcss()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/setupTests.ts"],
		coverage: {
			provider: "v8",
			reportOnFailure: true,
		},
	},
	build: {
		outDir: "build",
		rollupOptions: {
			output: {
				inlineDynamicImports: true,
				entryFileNames: `assets/[name].js`,
				chunkFileNames: `assets/[name].js`,
				assetFileNames: `assets/[name].[ext]`,
			},
		},
		chunkSizeWarningLimit: 100000,
	},
	server: {
		port: 25463,
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
	define: {
		"process.env": {
			NODE_ENV: JSON.stringify(process.env.IS_DEV ? "development" : "production"),
			IS_DEV: JSON.stringify(process.env.IS_DEV),
		},
	},
})
