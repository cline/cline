#!/usr/bin/env bun

export const DIRECT_PUBLISH_GUARD_MESSAGE = [
	"Direct packaging or publishing from apps/cli is disabled.",
	"The source package points its development bin at src/index.ts, while the npm package is generated under dist/cli.",
	"Run `bun run build:platforms` first, then `bun run publish:npm:dry` to preview the generated npm packages.",
	"Use `bun run publish:npm` to publish those generated packages.",
].join("\n");

export function shouldAllowDirectPublish(env: NodeJS.ProcessEnv): boolean {
	return env.CLINE_ALLOW_DIRECT_PUBLISH === "1";
}

if (import.meta.main && !shouldAllowDirectPublish(process.env)) {
	console.error(DIRECT_PUBLISH_GUARD_MESSAGE);
	process.exit(1);
}
