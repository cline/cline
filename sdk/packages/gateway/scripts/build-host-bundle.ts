import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const outputDir = resolve(import.meta.dir, "../dist-bin");
const outputFile = resolve(outputDir, "cline-gateway");

await mkdir(outputDir, { recursive: true });
const child = Bun.spawn(
	[
		"bun",
		"build",
		resolve(import.meta.dir, "../bin/cline-gateway.mjs"),
		"--target=node",
		`--outfile=${outputFile}`,
		"--minify",
	],
	{ stdout: "inherit", stderr: "inherit" },
);
if ((await child.exited) !== 0) process.exit(1);

await chmod(outputFile, 0o755);
console.log(outputFile);
