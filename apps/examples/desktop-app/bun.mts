import { $ } from "bun";

const main = async () => {
	await $`bun run build:sidecar:bin`;
	await $`next build`.cwd("webview");
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
