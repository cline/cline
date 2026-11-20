import { $ } from "bun";
import { resolveTargetTriple } from "./scripts/build-desktop-runtime";
import {
	recordWebviewInputs,
	writeDesktopThirdPartyNotices,
} from "./scripts/third-party-notices";

const main = async () => {
	await $`bun run build:runtime`;
	await $`next build`.cwd("webview");
	recordWebviewInputs();
	await writeDesktopThirdPartyNotices({
		targetTriple: await resolveTargetTriple(),
		allowMissingInputLists: false,
	});
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
