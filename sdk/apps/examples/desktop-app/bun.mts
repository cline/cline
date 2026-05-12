import { $ } from "bun";

const main = async () => {
	await $`next build`.cwd("webview");
	await $`bun run build:sidecar:bin`;
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
