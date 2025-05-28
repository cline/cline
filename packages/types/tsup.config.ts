import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: false,
	splitting: false,
	sourcemap: true,
	outDir: "dist",
})
