import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FACTORY_BROWSERS_PATH_ENV } from "@cline/core";
import { expect, it } from "vitest";
import { configureBundledVideoEncoder } from "./video-encoder";

it("names the encoder bundled in a macOS app for the Hub, unless one is already named", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-packaged-encoder-"));
	try {
		const contents = join(root, "Cline.app", "Contents");
		const browsers = join(contents, "Resources", "bin", "playwright");
		mkdirSync(browsers, { recursive: true });
		const options = {
			execPath: join(contents, "MacOS", "code-sidecar"),
			sourceDirectory: join(root, "source"),
		};
		const env: NodeJS.ProcessEnv = {};
		expect(configureBundledVideoEncoder({ ...options, env })).toBe(browsers);
		expect(env[FACTORY_BROWSERS_PATH_ENV]).toBe(browsers);

		const named = { [FACTORY_BROWSERS_PATH_ENV]: "/elsewhere" };
		configureBundledVideoEncoder({ ...options, env: named });
		expect(named[FACTORY_BROWSERS_PATH_ENV]).toBe("/elsewhere");

		const unbundled: NodeJS.ProcessEnv = {};
		expect(
			configureBundledVideoEncoder({
				execPath: join(root, "bun"),
				sourceDirectory: join(root, "source"),
				env: unbundled,
			}),
		).toBeUndefined();
		expect(unbundled).toEqual({});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
