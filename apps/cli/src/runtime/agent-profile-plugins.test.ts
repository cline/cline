import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentProfileDisabledPluginPaths } from "./agent-profile-plugins";

describe("resolveAgentProfileDisabledPluginPaths", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
	};

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_GLOBAL_SETTINGS_PATH =
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		setHomeDir(envSnapshot.HOME ?? "~");
	});

	async function setUpFixture(): Promise<{
		root: string;
		home: string;
		workspace: string;
		listedPlugin: string;
		unlistedPlugin: string;
		alwaysEnabledPlugin: string;
	}> {
		// Nested under a fixture root so the display-name package.json walk
		// never escapes into the shared temp directory.
		const root = await mkdtemp(join(tmpdir(), "cli-profile-plugins-"));
		const home = join(root, "home");
		const workspace = join(root, "workspace");
		await mkdir(home, { recursive: true });
		await mkdir(workspace, { recursive: true });
		process.env.HOME = home;
		setHomeDir(home);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(home, "global-settings.json");

		const workspacePlugins = join(workspace, ".cline", "plugins");
		const userPlugins = join(home, ".cline", "plugins");
		await mkdir(workspacePlugins, { recursive: true });
		await mkdir(userPlugins, { recursive: true });
		const listedPlugin = join(workspacePlugins, "listed-plugin.js");
		const unlistedPlugin = join(workspacePlugins, "unlisted-plugin.js");
		const alwaysEnabledPlugin = join(userPlugins, "always-on.js");
		await writeFile(listedPlugin, "export default {}", "utf8");
		await writeFile(unlistedPlugin, "export default {}", "utf8");
		await writeFile(alwaysEnabledPlugin, "export default {}", "utf8");

		return {
			root,
			home,
			workspace,
			listedPlugin,
			unlistedPlugin,
			alwaysEnabledPlugin,
		};
	}

	it("returns undefined when the profile has no plugins field", async () => {
		const fixture = await setUpFixture();
		try {
			expect(
				resolveAgentProfileDisabledPluginPaths(undefined, fixture.workspace),
			).toBeUndefined();
			expect(
				resolveAgentProfileDisabledPluginPaths({}, fixture.workspace),
			).toBeUndefined();
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("disables installed plugins not listed in the profile", async () => {
		const fixture = await setUpFixture();
		try {
			const disabled = resolveAgentProfileDisabledPluginPaths(
				{ plugins: ["Listed-Plugin"] },
				fixture.workspace,
			);
			expect(disabled).toContain(fixture.unlistedPlugin);
			expect(disabled).toContain(fixture.alwaysEnabledPlugin);
			expect(disabled).not.toContain(fixture.listedPlugin);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("exempts always-enabled plugins from profile disabling", async () => {
		const fixture = await setUpFixture();
		try {
			await writeFile(
				process.env.CLINE_GLOBAL_SETTINGS_PATH ?? "",
				JSON.stringify({
					alwaysEnabledPlugins: [fixture.alwaysEnabledPlugin],
				}),
				"utf8",
			);

			const disabled = resolveAgentProfileDisabledPluginPaths(
				{ plugins: ["listed-plugin"] },
				fixture.workspace,
			);
			expect(disabled).toContain(fixture.unlistedPlugin);
			expect(disabled).not.toContain(fixture.alwaysEnabledPlugin);
			expect(disabled).not.toContain(fixture.listedPlugin);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("disables everything but always-enabled plugins for an empty list", async () => {
		const fixture = await setUpFixture();
		try {
			await writeFile(
				process.env.CLINE_GLOBAL_SETTINGS_PATH ?? "",
				JSON.stringify({
					alwaysEnabledPlugins: [fixture.alwaysEnabledPlugin],
				}),
				"utf8",
			);

			const disabled = resolveAgentProfileDisabledPluginPaths(
				{ plugins: [] },
				fixture.workspace,
			);
			expect(disabled).toContain(fixture.listedPlugin);
			expect(disabled).toContain(fixture.unlistedPlugin);
			expect(disabled).not.toContain(fixture.alwaysEnabledPlugin);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("matches names resolved from an install wrapper package.json", async () => {
		const fixture = await setUpFixture();
		try {
			const installRoot = join(
				fixture.home,
				".cline",
				"plugins",
				"_installed",
				"registry",
				"branch-protector-abc123",
			);
			const packageRoot = join(installRoot, "package");
			await mkdir(packageRoot, { recursive: true });
			await writeFile(
				join(installRoot, "package.json"),
				JSON.stringify({
					name: "branch-protector",
					private: true,
					cline: { plugins: [{ paths: ["./package/index.ts"] }] },
				}),
				"utf8",
			);
			const wrappedEntry = join(packageRoot, "index.ts");
			await writeFile(wrappedEntry, "export default {}", "utf8");

			const disabled = resolveAgentProfileDisabledPluginPaths(
				{ plugins: ["branch-protector"] },
				fixture.workspace,
			);
			expect(disabled).not.toContain(wrappedEntry);
			expect(disabled).toContain(fixture.listedPlugin);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
});
