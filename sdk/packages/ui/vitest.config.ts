import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	test: {
		environment: "jsdom",
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
	},
});
