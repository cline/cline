import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
	installAgentProfile,
	parseAgentSource,
	planAgentPluginInstalls,
	uninstallAgentProfile,
} from "./agent";

const PROFILE = `---
name: reviewer
description: Reviews code
plugins:
  - branch-protector
  - name: my-tool
    install: https://example.com/my-tool.ts
---
You are a meticulous reviewer.`;

describe("agent command", () => {
	const envSnapshot = { HOME: process.env.HOME };

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		setHomeDir(envSnapshot.HOME ?? "~");
	});

	async function setUpHome(): Promise<{ root: string; home: string }> {
		// Home is nested under a fixture root so the plugin display-name
		// package.json walk never escapes into the shared temp directory.
		const root = await mkdtemp(join(tmpdir(), "cli-agent-cmd-"));
		const home = join(root, "home");
		await mkdir(home, { recursive: true });
		process.env.HOME = home;
		setHomeDir(home);
		return { root, home };
	}

	describe("parseAgentSource", () => {
		it("parses local paths, official slugs, and remote URLs", () => {
			expect(parseAgentSource("./reviewer.yml")).toEqual({
				type: "local",
				path: "./reviewer.yml",
			});
			expect(parseAgentSource("~/agents/reviewer.yaml")).toEqual({
				type: "local",
				path: "~/agents/reviewer.yaml",
			});
			expect(parseAgentSource("reviewer")).toEqual({
				type: "official",
				slug: "reviewer",
			});
			expect(parseAgentSource("code-reviewer")).toEqual({
				type: "official",
				slug: "code-reviewer",
			});
			expect(
				parseAgentSource("https://example.com/profiles/reviewer.yml"),
			).toEqual({
				type: "remote",
				url: "https://example.com/profiles/reviewer.yml",
				filename: "reviewer.yml",
			});
		});

		it("rewrites GitHub blob URLs to raw URLs", () => {
			expect(
				parseAgentSource(
					"https://github.com/cline/agents/blob/main/agents/reviewer.yml",
				),
			).toEqual({
				type: "remote",
				url: "https://raw.githubusercontent.com/cline/agents/main/agents/reviewer.yml",
				filename: "reviewer.yml",
			});
		});

		it("rejects non-yaml GitHub file URLs and http URLs", () => {
			expect(() =>
				parseAgentSource(
					"https://github.com/cline/agents/blob/main/agents/reviewer.md",
				),
			).toThrow(/must be \.yml or \.yaml/);
			expect(() => parseAgentSource("http://example.com/reviewer.yml")).toThrow(
				/must use https/,
			);
		});
	});

	describe("installAgentProfile", () => {
		it("validates and writes the profile under the global agents dir", async () => {
			const { root, home } = await setUpHome();
			try {
				const { config, installPath } = installAgentProfile({
					content: PROFILE,
					source: "./reviewer.yml",
				});
				expect(config.name).toBe("reviewer");
				expect(installPath).toBe(
					join(home, ".cline", "agents", "reviewer.yml"),
				);
				expect(readFileSync(installPath, "utf8")).toBe(PROFILE);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("rejects invalid profiles before writing anything", async () => {
			const { root, home } = await setUpHome();
			try {
				expect(() =>
					installAgentProfile({
						content: "not a profile",
						source: "./broken.yml",
					}),
				).toThrow(/Invalid agent profile from \.\/broken\.yml/);
				expect(existsSync(join(home, ".cline", "agents"))).toBe(false);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("refuses to replace an existing profile without force", async () => {
			const { root } = await setUpHome();
			try {
				installAgentProfile({ content: PROFILE, source: "a" });
				expect(() =>
					installAgentProfile({ content: PROFILE, source: "a" }),
				).toThrow(/already installed/);
				expect(() =>
					installAgentProfile({ content: PROFILE, source: "a", force: true }),
				).not.toThrow();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	});

	describe("planAgentPluginInstalls", () => {
		it("classifies listed plugins as installed, installable, or manual", async () => {
			const { root, home } = await setUpHome();
			try {
				const userPlugins = join(home, ".cline", "plugins");
				await mkdir(userPlugins, { recursive: true });
				await writeFile(
					join(userPlugins, "branch-protector.ts"),
					"export default {}",
					"utf8",
				);

				const plan = planAgentPluginInstalls([
					{ name: "Branch-Protector" },
					{ name: "my-tool", install: "https://example.com/my-tool.ts" },
					{ name: "mystery-plugin" },
				]);

				expect(plan.alreadyInstalled).toEqual([{ name: "Branch-Protector" }]);
				expect(plan.installable).toEqual([
					{ name: "my-tool", install: "https://example.com/my-tool.ts" },
				]);
				expect(plan.manual).toEqual([{ name: "mystery-plugin" }]);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("returns an empty plan when the profile lists no plugins", async () => {
			const { root } = await setUpHome();
			try {
				expect(planAgentPluginInstalls(undefined)).toEqual({
					alreadyInstalled: [],
					installable: [],
					manual: [],
				});
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	});

	describe("uninstallAgentProfile", () => {
		it("removes a profile by frontmatter name or file name", async () => {
			const { root } = await setUpHome();
			try {
				installAgentProfile({ content: PROFILE, source: "a" });
				const result = uninstallAgentProfile("Reviewer");
				expect(result.name).toBe("reviewer");
				expect(existsSync(result.installPath)).toBe(false);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});

		it("lists available profiles when the name does not match", async () => {
			const { root } = await setUpHome();
			try {
				installAgentProfile({ content: PROFILE, source: "a" });
				expect(() => uninstallAgentProfile("nope")).toThrow(
					/available: reviewer/,
				);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	});
});
