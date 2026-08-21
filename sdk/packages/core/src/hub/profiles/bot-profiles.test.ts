import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadBotProfile,
	PLAIN_BOT_PROFILE,
	resolveBotProfile,
} from "./bot-profiles";

function writeProfileFixture(options: {
	document?: Record<string, unknown>;
	identity?: string;
	rules?: Record<string, string>;
	plugins?: Record<string, { skills?: Record<string, string> }>;
}): string {
	const root = mkdtempSync(join(tmpdir(), "cline-bot-profile-"));
	if (options.identity !== undefined) {
		writeFileSync(join(root, "identity.md"), options.identity);
	}
	for (const [name, content] of Object.entries(options.rules ?? {})) {
		mkdirSync(join(root, "rules"), { recursive: true });
		writeFileSync(join(root, "rules", name), content);
	}
	for (const [pluginName, plugin] of Object.entries(options.plugins ?? {})) {
		const pluginRoot = join(root, "plugins", pluginName);
		mkdirSync(pluginRoot, { recursive: true });
		writeFileSync(
			join(pluginRoot, "plugin.json"),
			JSON.stringify({ name: pluginName }),
		);
		for (const [skillName, content] of Object.entries(plugin.skills ?? {})) {
			const skillDir = join(pluginRoot, "skills", skillName);
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(join(skillDir, "SKILL.md"), content);
		}
	}
	const document = {
		id: "test-bot",
		name: "Test Bot",
		description: "A bot profile fixture.",
		...(options.identity !== undefined ? { identity: "identity.md" } : {}),
		rules: Object.keys(options.rules ?? {}).map((name) => `rules/${name}`),
		plugins: Object.keys(options.plugins ?? {}).map(
			(name) => `plugins/${name}`,
		),
		...options.document,
	};
	const file = join(root, "profile.json");
	writeFileSync(file, JSON.stringify(document));
	return file;
}

describe("bot profiles", () => {
	it("resolves the plain profile for the default selector", () => {
		expect(resolveBotProfile(undefined)).toBe(PLAIN_BOT_PROFILE);
		expect(resolveBotProfile("cline")).toBe(PLAIN_BOT_PROFILE);
		expect(resolveBotProfile("  ")).toBe(PLAIN_BOT_PROFILE);
	});

	it("renders rules and plugin skills into the system prompt", () => {
		const file = writeProfileFixture({
			rules: { "identity.md": "You are {{ADMIN_NAME}}'s hub." },
			plugins: {
				support: {
					skills: { diagnose: "Diagnose things for {{ADMIN_NAME}}." },
				},
			},
		});
		const profile = loadBotProfile(file, { ADMIN_NAME: "Beatrix" });
		expect(profile.id).toBe("test-bot");
		expect(profile.systemPrompt).toContain("# Rule: identity.md");
		expect(profile.systemPrompt).toContain("You are Beatrix's hub.");
		expect(profile.systemPrompt).toContain("# Skill: diagnose");
		expect(profile.systemPrompt).toContain("Diagnose things for Beatrix.");
		expect(profile.pluginRoots).toHaveLength(1);
	});

	it("renders identity first, distinct from rules and skills", () => {
		const file = writeProfileFixture({
			identity: "You are {{ADMIN_NAME}}'s persona.",
			rules: { "extra.md": "An extra rule." },
		});
		const profile = loadBotProfile(file, { ADMIN_NAME: "Beatrix" });
		expect(profile.identity).toBe("You are Beatrix's persona.");
		expect(profile.systemPrompt.indexOf("You are Beatrix's persona.")).toBe(0);
		expect(profile.systemPrompt).toContain("An extra rule.");
	});

	it("leaves identity undefined when the profile declares none", () => {
		const file = writeProfileFixture({ rules: { "r.md": "rule body" } });
		const profile = loadBotProfile(file);
		expect(profile.identity).toBeUndefined();
	});

	it("fails closed on a missing identity file", () => {
		const file = writeProfileFixture({
			document: { identity: "identity.md" },
		});
		expect(() => loadBotProfile(file)).toThrow(/Missing bot profile identity/);
	});

	it("fails closed on an identity path escaping the profile root", () => {
		const file = writeProfileFixture({
			document: { identity: "../../etc/passwd" },
		});
		expect(() => loadBotProfile(file)).toThrow(/escapes its root/);
	});

	it("substitutes defaults for unset template variables and keeps unknown ones", () => {
		const file = writeProfileFixture({
			rules: { "vars.md": "{{ADMIN_NAME}} / {{UNKNOWN_VAR}} / {{admin_name}}" },
		});
		const profile = loadBotProfile(file);
		expect(profile.systemPrompt).toContain(
			"the administrator / {{UNKNOWN_VAR}} / the administrator",
		);
	});

	it("fails closed on a missing rule", () => {
		const file = writeProfileFixture({
			document: { rules: ["rules/missing.md"] },
		});
		expect(() => loadBotProfile(file)).toThrow(/Missing bot profile rule/);
	});

	it("fails closed on a rule path escaping the profile root", () => {
		const file = writeProfileFixture({
			document: { rules: ["../../etc/passwd"] },
		});
		expect(() => loadBotProfile(file)).toThrow(/escapes its root/);
	});

	it("fails closed on a plugin root without plugin.json", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-bot-profile-"));
		mkdirSync(join(root, "plugins", "empty"), { recursive: true });
		const file = join(root, "profile.json");
		writeFileSync(
			file,
			JSON.stringify({
				id: "test-bot",
				name: "Test Bot",
				description: "A bot profile fixture.",
				rules: [],
				plugins: ["plugins/empty"],
			}),
		);
		expect(() => loadBotProfile(file)).toThrow(/no plugin\.json/);
	});

	it("rejects an unknown selector with a diagnosis", () => {
		expect(() => resolveBotProfile("nope-not-a-profile")).toThrow(
			/Unknown bot profile/,
		);
	});

	it("accepts a profile directory as the selector", () => {
		const file = writeProfileFixture({ rules: { "r.md": "rule body" } });
		const profile = resolveBotProfile(join(file, ".."));
		expect(profile.systemPrompt).toContain("rule body");
	});

	it("rejects invalid ids", () => {
		const file = writeProfileFixture({ document: { id: "Bad Id!" } });
		expect(() => loadBotProfile(file)).toThrow(/Invalid bot profile id/);
	});
});
