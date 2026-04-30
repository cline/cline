import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	readGlobalSettings,
	setDisabledPlugin,
	setDisabledTools,
} from "./global-settings";

describe("global-settings", () => {
	const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;

	afterEach(() => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath;
	});

	it("preserves disabled tools and plugins across targeted updates", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
		try {
			const settingsPath = join(root, "global-settings.json");
			process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;

			setDisabledPlugin("/plugins/example.js", true);
			setDisabledTools(["read_files", "editor"], true);
			setDisabledTools(["editor"], false);

			expect(readGlobalSettings()).toEqual({
				disabledPlugins: ["/plugins/example.js"],
				disabledTools: ["read_files"],
			});
			expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
				disabledPlugins: ["/plugins/example.js"],
				disabledTools: ["read_files"],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
