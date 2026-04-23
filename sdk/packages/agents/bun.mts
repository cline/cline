/// <reference types="@types/bun" />
export {};

// Only externalize published packages; bundle internal workspace packages
// used by agents. Post Step 9, the only runtime dep is `nanoid` (for
// `createUID`). `@clinebot/shared` is the one workspace dep and is bundled.
const external = ["nanoid"];

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		minify: true,
		sourcemap: "none",
		packages: "bundle",
		external,
	},
];

for (const config of builds) {
	const result = await Bun.build(config);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}
