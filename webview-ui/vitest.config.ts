import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/setupTests.ts"],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
		},
		include: ["src/**/*.{test,spec}.{js,ts,jsx,tsx}"],
		deps: {
			interopDefault: true,
		},
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});