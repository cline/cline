import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ITelemetryService } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GlobalSettingsSchema,
	readGlobalSettings,
	setDisabledPlugin,
	setDisabledTools,
	setTelemetryOptOutGlobally,
	writeGlobalSettings,
} from "./global-settings";

describe("global-settings", () => {
	const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;

	afterEach(() => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath;
	});

	it("defines the global settings file schema", () => {
		expect(
			GlobalSettingsSchema.parse({
				disabledTools: [" read_files ", "read_files", "editor"],
				disabledPlugins: ["/plugins/example.js", "/plugins/example.js"],
			}),
		).toEqual({
			disabledPlugins: ["/plugins/example.js"],
			disabledTools: ["editor", "read_files"],
			telemetryOptOut: false,
		});
		expect(
			GlobalSettingsSchema.parse({
				disabledTools: [],
				telemetryOptOut: true,
			}),
		).toEqual({ telemetryOptOut: true });
		expect(GlobalSettingsSchema.parse({ disabledTools: [] })).toEqual({
			telemetryOptOut: false,
		});
		expect(
			GlobalSettingsSchema.parse({
				disabledTools: ["read_files"],
				extra: true,
			}),
		).toEqual({
			disabledTools: ["read_files"],
			telemetryOptOut: false,
		});
		expect(
			GlobalSettingsSchema.parse({
				disabledTools: 42,
				extra: true,
				telemetryOptOut: true,
			}),
		).toEqual({
			telemetryOptOut: true,
		});
	});

	it("uses the schema when reading and writing settings", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
		try {
			const settingsPath = join(root, "global-settings.json");
			process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;

			writeGlobalSettings({
				disabledTools: [" editor ", "read_files", "editor"],
				disabledPlugins: [],
			});

			expect(readGlobalSettings()).toEqual({
				disabledTools: ["editor", "read_files"],
				telemetryOptOut: false,
			});
			expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
				disabledTools: ["editor", "read_files"],
				telemetryOptOut: false,
			});

			await writeFile(
				settingsPath,
				JSON.stringify({
					disabledTools: ["read_files"],
					extra: true,
					telemetryOptOut: true,
				}),
			);
			expect(readGlobalSettings()).toEqual({
				disabledTools: ["read_files"],
				telemetryOptOut: true,
			});

			await writeFile(
				settingsPath,
				JSON.stringify({
					disabledTools: 42,
					extra: true,
					telemetryOptOut: true,
				}),
			);
			expect(readGlobalSettings()).toEqual({ telemetryOptOut: true });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
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
				telemetryOptOut: false,
			});
			expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
				disabledPlugins: ["/plugins/example.js"],
				disabledTools: ["read_files"],
				telemetryOptOut: false,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("records telemetry opt-out once when the setting changes to true", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
		try {
			const settingsPath = join(root, "global-settings.json");
			process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
			const captureRequired = vi.fn();
			const telemetry = {
				captureRequired,
			} as unknown as ITelemetryService;

			setTelemetryOptOutGlobally(true, { telemetry });
			setTelemetryOptOutGlobally(true, { telemetry });
			setTelemetryOptOutGlobally(false, { telemetry });

			expect(captureRequired).toHaveBeenCalledTimes(1);
			expect(captureRequired).toHaveBeenCalledWith("user.opt_out", undefined);
			expect(readGlobalSettings()).toEqual({ telemetryOptOut: false });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
