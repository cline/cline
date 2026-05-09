import { $ } from "bun";

const main = async () => {
	await $`next build`.cwd("webview");
	await $`mkdir -p dist/sidecar`;
	await $`bun build ./sidecar/index.ts --outfile ./dist/sidecar/index.js --target bun`;
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
