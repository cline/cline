import { describe, expect, it } from "bun:test";
import { generateManifest } from "./gen-manifest.mjs";

const shared = {
	name: "claude-dev",
	publisher: "saoudrizwan",
	main: "./dist/extension.js",
	engines: { vscode: "^1.84.0" },
	displayName: "Cline",
};

function pkg(overrides) {
	return {
		...shared,
		activationEvents: ["onStartupFinished"],
		contributes: {
			viewsContainers: {
				activitybar: [{ id: "c", title: "Cline", icon: "assets/icon.svg" }],
			},
			views: { c: [{ type: "webview", id: "claude-dev.SidebarProvider" }] },
			commands: [],
			keybindings: [],
			menus: {},
			icons: {},
			...overrides.contributes,
		},
		...Object.fromEntries(
			Object.entries(overrides).filter(([k]) => k !== "contributes"),
		),
	};
}

describe("generateManifest", () => {
	it("unions commands, menus, keybindings and activation events", () => {
		const next = pkg({
			contributes: {
				commands: [
					{ command: "cline.a", title: "A" },
					{ command: "cline.shared", title: "S" },
				],
				menus: { "view/title": [{ command: "cline.a", when: "x" }] },
			},
		});
		const legacy = pkg({
			activationEvents: ["onStartupFinished", "workspaceContains:evals.env"],
			contributes: {
				commands: [
					{ command: "cline.b", title: "B" },
					{ command: "cline.shared", title: "S" },
				],
				menus: {
					"view/title": [{ command: "cline.b", when: "y" }],
					"comments/commentThread/title": [{ command: "cline.b" }],
				},
				keybindings: [{ command: "cline.b", key: "ctrl+k" }],
			},
		});
		const manifest = generateManifest(next, legacy, "4.1.0");
		expect(manifest.version).toBe("4.1.0");
		expect(manifest.main).toBe("./extension.js");
		expect(manifest.contributes.commands.map((c) => c.command).sort()).toEqual([
			"cline.a",
			"cline.b",
			"cline.shared",
		]);
		expect(manifest.contributes.menus["view/title"]).toHaveLength(2);
		expect(
			manifest.contributes.menus["comments/commentThread/title"],
		).toHaveLength(1);
		expect(manifest.contributes.keybindings).toHaveLength(1);
		expect(manifest.activationEvents).toContain("workspaceContains:evals.env");
	});

	it("gates cohort-exclusive menu entries and keybindings on the context key", () => {
		const next = pkg({
			contributes: {
				commands: [
					{ command: "cline.a", title: "A" },
					{ command: "cline.shared", title: "S" },
				],
				menus: {
					"view/title": [
						{ command: "cline.a", when: "x" },
						{ command: "cline.shared", when: "v" },
					],
				},
			},
		});
		const legacy = pkg({
			contributes: {
				commands: [
					{ command: "cline.b", title: "B" },
					{ command: "cline.shared", title: "S" },
				],
				menus: {
					"view/title": [
						{ command: "cline.b", when: "y" },
						{ command: "cline.shared", when: "v" },
					],
				},
				keybindings: [{ command: "cline.b", key: "ctrl+k", when: "focus" }],
			},
		});
		const manifest = generateManifest(next, legacy, "4.1.0");
		const viewTitle = manifest.contributes.menus["view/title"];
		expect(viewTitle.find((e) => e.command === "cline.a").when).toBe(
			"(x) && cline.sdkBundle",
		);
		expect(viewTitle.find((e) => e.command === "cline.b").when).toBe(
			"(y) && !cline.sdkBundle",
		);
		expect(viewTitle.find((e) => e.command === "cline.shared").when).toBe("v");
		expect(manifest.contributes.keybindings[0].when).toBe(
			"(focus) && !cline.sdkBundle",
		);
	});

	it("hides cohort-exclusive commands from the other cohort's palette", () => {
		const next = pkg({
			contributes: {
				commands: [
					{ command: "cline.nextOnly", title: "N" },
					{ command: "cline.shared", title: "S" },
				],
			},
		});
		const legacy = pkg({
			contributes: {
				commands: [
					{ command: "cline.legacyOnly", title: "L" },
					{ command: "cline.shared", title: "S" },
				],
			},
		});
		const palette = generateManifest(next, legacy, "4.1.0").contributes.menus
			.commandPalette;
		expect(palette).toContainEqual({
			command: "cline.nextOnly",
			when: "cline.sdkBundle",
		});
		expect(palette).toContainEqual({
			command: "cline.legacyOnly",
			when: "!cline.sdkBundle",
		});
		expect(palette.find((e) => e.command === "cline.shared")).toBeUndefined();
	});

	it("leaves commands alone when a bundle already declares a palette entry for them", () => {
		const next = pkg({
			contributes: { commands: [{ command: "cline.shared", title: "S" }] },
		});
		const legacy = pkg({
			contributes: {
				commands: [
					{ command: "cline.hidden", title: "H" },
					{ command: "cline.shared", title: "S" },
				],
				menus: { commandPalette: [{ command: "cline.hidden", when: "false" }] },
			},
		});
		const palette = generateManifest(next, legacy, "4.1.0").contributes.menus
			.commandPalette;
		expect(palette.filter((e) => e.command === "cline.hidden")).toEqual([
			{ command: "cline.hidden", when: "(false) && !cline.sdkBundle" },
		]);
	});

	it("dedupes structurally identical menu entries", () => {
		const entry = { command: "cline.a", when: "view == cline" };
		const next = pkg({
			contributes: {
				commands: [{ command: "cline.a", title: "A" }],
				menus: { "view/title": [entry] },
			},
		});
		const legacy = pkg({
			contributes: {
				commands: [{ command: "cline.a", title: "A" }],
				menus: { "view/title": [{ ...entry }] },
			},
		});
		expect(
			generateManifest(next, legacy, "1.0.0").contributes.menus["view/title"],
		).toHaveLength(1);
	});

	it("rejects diverged views/viewsContainers", () => {
		const next = pkg({});
		const legacy = pkg({
			contributes: { views: { c: [{ type: "webview", id: "other" }] } },
		});
		expect(() => generateManifest(next, legacy, "1.0.0")).toThrow(/views/);
	});

	it("rejects structurally diverged walkthroughs", () => {
		const walkthrough = (stepId, media) => ({
			contributes: {
				walkthroughs: [
					{
						id: "ClineWalkthrough",
						title: "Meet Cline",
						steps: [{ id: stepId, title: "Start here", media }],
					},
				],
			},
		});
		expect(() =>
			generateManifest(
				pkg(walkthrough("welcome", { markdown: "walkthrough/step1.md" })),
				pkg(walkthrough("hello", { markdown: "walkthrough/step1.md" })),
				"1.0.0",
			),
		).toThrow(/walkthroughs diverged structurally/);
		expect(() =>
			generateManifest(
				pkg(walkthrough("welcome", { markdown: "walkthrough/step1.md" })),
				pkg(walkthrough("welcome", { markdown: "walkthrough/other.md" })),
				"1.0.0",
			),
		).toThrow(/walkthroughs diverged structurally/);
	});

	it("tolerates copy-only walkthrough divergence, shipping next's text", () => {
		const walkthrough = (description) => ({
			contributes: {
				walkthroughs: [
					{
						id: "ClineWalkthrough",
						title: "Meet Cline",
						steps: [
							{
								id: "welcome",
								title: "Start here",
								description,
								media: { markdown: "walkthrough/step1.md" },
							},
						],
					},
				],
			},
		});
		const manifest = generateManifest(
			pkg(walkthrough("Connect via MCP.")),
			pkg(walkthrough("Discover the MCP Marketplace.")),
			"1.0.0",
		);
		expect(manifest.contributes.walkthroughs[0].steps[0].description).toBe(
			"Connect via MCP.",
		);
	});

	it("rejects diverged configuration", () => {
		const next = pkg({
			contributes: {
				configuration: {
					title: "Cline",
					properties: {
						"cline.enabled": { type: "boolean", default: false },
					},
				},
			},
		});
		const legacy = pkg({
			contributes: {
				configuration: {
					title: "Cline",
					properties: {
						"cline.enabled": { type: "boolean", default: 0 },
					},
				},
			},
		});
		expect(() => generateManifest(next, legacy, "1.0.0")).toThrow(
			/contributes\.configuration diverged/,
		);
	});

	it("injects the loader-owned bundleOverride setting into the union", () => {
		const manifest = generateManifest(pkg({}), pkg({}), "4.1.0");
		const prop =
			manifest.contributes.configuration.properties[
				"cline.rollout.bundleOverride"
			];
		expect(prop).toBeDefined();
		expect(prop.enum).toEqual(["auto", "next", "legacy"]);
		expect(prop.default).toBe("auto");
		expect(prop.scope).toBe("application");
	});

	it("rejects bundles that declare the loader-owned setting themselves", () => {
		const withClash = {
			contributes: {
				configuration: {
					title: "Cline",
					properties: { "cline.rollout.bundleOverride": { type: "string" } },
				},
			},
		};
		expect(() =>
			generateManifest(pkg(withClash), pkg(withClash), "4.1.0"),
		).toThrow(/loader-owned setting/);
	});

	it("rejects diverged engines", () => {
		const legacy = { ...pkg({}), engines: { vscode: "^1.90.0" } };
		expect(() => generateManifest(pkg({}), legacy, "1.0.0")).toThrow(/engines/);
	});

	it("rejects conflicting icon definitions", () => {
		const next = pkg({
			contributes: {
				icons: {
					"cline-logo": {
						description: "d",
						default: { fontPath: "a.woff", fontCharacter: "\\E900" },
					},
				},
			},
		});
		const legacy = pkg({
			contributes: {
				icons: {
					"cline-logo": {
						description: "d",
						default: { fontPath: "b.woff", fontCharacter: "\\E900" },
					},
				},
			},
		});
		expect(() => generateManifest(next, legacy, "1.0.0")).toThrow(/icons/);
	});
});
