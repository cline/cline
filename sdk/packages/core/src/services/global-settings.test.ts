import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	GlobalSettingsSchema,
	readCompactionStrategyGlobally,
	readGlobalSettings,
	setAutoUpdateEnabledGlobally,
	setCompactionStrategyGlobally,
	setDisabledPlugin,
	setDisabledTools,
	writeGlobalSettings,
} from "./global-settings";

describe("global-settings", () => {
	const previousGlobalSettingsPath = process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH;

	afterEach(() => {
		process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath;
	});

	it("defines the global settings file schema", () => {
		expect(
			GlobalSettingsSchema.parse({
				disabledTools: [" read_files ", "read_files", "editor"],
				disabledPlugins: ["/plugins/example.js", "/plugins/example.js"],
			}),
		).toEqual({
			autoUpdateEnabled: true,
			disabledPlugins: ["/plugins/example.js"],
			disabledTools: ["editor", "read_files"],
		});
		expect(GlobalSettingsSchema.parse({ disabledTools: [] })).toEqual({
			autoUpdateEnabled: true,
		});
		expect(
			GlobalSettingsSchema.parse({
				compactionStrategy: "agentic",
				disabledTools: ["read_files"],
				extra: true,
			}),
		).toEqual({
			autoUpdateEnabled: true,
			compactionStrategy: "agentic",
			disabledTools: ["read_files"],
		});
		expect(
			GlobalSettingsSchema.parse({
				disabledTools: 42,
				extra: true,
			}),
		).toEqual({
			autoUpdateEnabled: true,
		});
		expect(
			GlobalSettingsSchema.parse({
				autoUpdateEnabled: false,
			}),
		).toEqual({
			autoUpdateEnabled: false,
		});
	});

	it("uses the schema when reading and writing settings", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
		try {
			const settingsPath = join(root, "global-settings.json");
			process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;

			writeGlobalSettings({
				disabledTools: [" editor ", "read_files", "editor"],
				disabledPlugins: [],
			});

			expect(readGlobalSettings()).toEqual({
				autoUpdateEnabled: true,
				disabledTools: ["editor", "read_files"],
			});
			expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
				autoUpdateEnabled: true,
				disabledTools: ["editor", "read_files"],
			});

			await writeFile(
				settingsPath,
				JSON.stringify({
					disabledTools: ["read_files"],
					extra: true,
				}),
			);
			expect(readGlobalSettings()).toEqual({
				autoUpdateEnabled: true,
				disabledTools: ["read_files"],
			});

			await writeFile(
				settingsPath,
				JSON.stringify({
					disabledTools: 42,
					extra: true,
				}),
			);
			expect(readGlobalSettings()).toEqual({
				autoUpdateEnabled: true,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves disabled tools and plugins across targeted updates", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
		try {
			const settingsPath = join(root, "global-settings.json");
			process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;

			setDisabledPlugin("/plugins/example.js", true);
			setDisabledTools(["read_files", "editor"], true);
			setDisabledTools(["editor"], false);

			expect(readGlobalSettings()).toEqual({
				autoUpdateEnabled: true,
				disabledPlugins: ["/plugins/example.js"],
				disabledTools: ["read_files"],
			});
			expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
				autoUpdateEnabled: true,
				disabledPlugins: ["/plugins/example.js"],
				disabledTools: ["read_files"],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves other settings when auto update is changed", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
		try {
			const settingsPath = join(root, "global-settings.json");
			process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;

			writeGlobalSettings({
				disabledTools: ["editor"],
			});
			setAutoUpdateEnabledGlobally(false);

			expect(readGlobalSettings()).toEqual({
				autoUpdateEnabled: false,
				disabledTools: ["editor"],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reads and writes the compaction strategy globally", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
		try {
			const settingsPath = join(root, "global-settings.json");
			process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;

			expect(readCompactionStrategyGlobally()).toBe("agentic");
			setCompactionStrategyGlobally("agentic");
			expect(readCompactionStrategyGlobally()).toBe("agentic");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	describe("caching", () => {
		it("invalidates the cache when writeGlobalSettings is called", async () => {
			const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
			try {
				const settingsPath = join(root, "global-settings.json");
				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;
				writeGlobalSettings({ disabledTools: ["editor"] });
				readGlobalSettings();

				writeGlobalSettings({ disabledTools: ["read_files"] });

				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledTools: ["read_files"],
				});
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("picks up external writes via mtime change", async () => {
			const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
			try {
				const settingsPath = join(root, "global-settings.json");
				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;
				writeGlobalSettings({ disabledTools: ["editor"] });
				readGlobalSettings();

				await writeFile(
					settingsPath,
					JSON.stringify({ disabledTools: ["read_files"] }),
				);

				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledTools: ["read_files"],
				});
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("keys the cache by resolved path so switching files returns the right value", async () => {
			const rootA = await mkdtemp(join(tmpdir(), "core-global-settings-"));
			const rootB = await mkdtemp(join(tmpdir(), "core-global-settings-"));
			try {
				const pathA = join(rootA, "global-settings.json");
				const pathB = join(rootB, "global-settings.json");

				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = pathA;
				writeGlobalSettings({ disabledTools: ["editor"] });
				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledTools: ["editor"],
				});

				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = pathB;
				writeGlobalSettings({ disabledTools: ["read_files"] });
				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledTools: ["read_files"],
				});

				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = pathA;
				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledTools: ["editor"],
				});
			} finally {
				await rm(rootA, { recursive: true, force: true });
				await rm(rootB, { recursive: true, force: true });
			}
		});

		it("returns the default value when the settings file does not exist", async () => {
			const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
			try {
				const settingsPath = join(root, "missing-global-settings.json");
				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;

				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
				});
				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
				});
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("returns a frozen value so callers cannot mutate the cache", async () => {
			const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
			try {
				const settingsPath = join(root, "global-settings.json");
				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;
				writeGlobalSettings({
					disabledTools: ["editor"],
					disabledPlugins: ["/plugins/example.js"],
				});

				const settings = readGlobalSettings();

				expect(Object.isFrozen(settings)).toBe(true);
				expect(Object.isFrozen(settings.disabledTools)).toBe(true);
				expect(Object.isFrozen(settings.disabledPlugins)).toBe(true);
				expect(() => {
					settings.disabledTools?.push("malicious");
				}).toThrow();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("transitions from missing-file default to fresh value once the file is created", async () => {
			const root = await mkdtemp(join(tmpdir(), "core-global-settings-"));
			try {
				const settingsPath = join(root, "global-settings.json");
				process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = settingsPath;

				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
				});

				await writeFile(
					settingsPath,
					JSON.stringify({ disabledTools: ["editor"] }),
				);

				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledTools: ["editor"],
				});
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	});
});
