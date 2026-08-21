import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAIN_BOT_PROFILE } from "./bot-profiles";
import {
	CLINE_DAD_PROFILE_ID,
	resolveClineDadProfile,
	resolveHubBotProfile,
} from "./cline-dad";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("Cline Dad bundled profile", () => {
	it("resolves by id with no files on disk", () => {
		vi.stubEnv("CLINE_HUB_PROFILES_DIR", "");
		const profile = resolveHubBotProfile(CLINE_DAD_PROFILE_ID);
		expect(profile.id).toBe(CLINE_DAD_PROFILE_ID);
		expect(profile.name).toBe("Cline Dad");
		expect(profile.includeHubSupportTool).toBe(true);
	});

	it("teaches hub semantics, self-unblocking, and user configuration", () => {
		const profile = resolveClineDadProfile({ ADMIN_NAME: "Beatrix" });
		const prompt = profile.systemPrompt;
		// Identity + personalization
		expect(prompt).toContain("You are **Cline Dad**");
		expect(prompt).toContain("Beatrix");
		// Identity is its own field, distinct from the rules, and rendered first
		expect(profile.identity).toContain("You are **Cline Dad**");
		expect(prompt.indexOf(profile.identity ?? "")).toBe(0);
		// Hub semantics: lock is authority, never force a takeover
		expect(prompt).toContain("instance lock");
		expect(prompt).toContain("Never delete discovery, lock, or");
		// Self-unblocking: retryable errors, replay, interrupted runs
		expect(prompt).toContain("hub_draining");
		expect(prompt).toContain("cursor replay");
		expect(prompt).toContain("interrupted");
		// Diagnose-first via the support tool
		expect(prompt).toContain("cline_hub_support");
		// Helping users configure Cline
		expect(prompt).toContain(
			"cline hub status | ensure | drain | upgrade | stop",
		);
		expect(prompt).toContain("cline doctor");
		expect(prompt).toContain("CLINE_HUB_BOT_PROFILE");
	});

	it("defaults the admin name when unset", () => {
		const profile = resolveClineDadProfile();
		expect(profile.systemPrompt).toContain("the administrator");
		expect(profile.systemPrompt).not.toContain("{{ADMIN_NAME}}");
	});

	it("an operator profile in CLINE_HUB_PROFILES_DIR overrides the bundle", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-dad-override-"));
		const profileDir = join(root, "cline-dad");
		mkdirSync(join(profileDir, "rules"), { recursive: true });
		writeFileSync(
			join(profileDir, "rules", "custom.md"),
			"Custom override rule.",
		);
		writeFileSync(
			join(profileDir, "profile.json"),
			JSON.stringify({
				id: "cline-dad",
				name: "Cline Dad (site)",
				description: "Site-customized Cline Dad.",
				rules: ["rules/custom.md"],
				plugins: [],
			}),
		);
		vi.stubEnv("CLINE_HUB_PROFILES_DIR", root);
		const profile = resolveHubBotProfile(CLINE_DAD_PROFILE_ID);
		expect(profile.name).toBe("Cline Dad (site)");
		expect(profile.systemPrompt).toContain("Custom override rule.");
		// The override still gets the hub support tool.
		expect(profile.includeHubSupportTool).toBe(true);
	});

	it("resolves non-bundled ids from the profiles dir too", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-dad-custom-"));
		const profileDir = join(root, "site-bot");
		mkdirSync(join(profileDir, "rules"), { recursive: true });
		writeFileSync(join(profileDir, "rules", "r.md"), "Site bot rule.");
		writeFileSync(
			join(profileDir, "profile.json"),
			JSON.stringify({
				id: "site-bot",
				name: "Site Bot",
				description: "A site-defined profile.",
				rules: ["rules/r.md"],
				plugins: [],
			}),
		);
		vi.stubEnv("CLINE_HUB_PROFILES_DIR", root);
		const profile = resolveHubBotProfile("site-bot");
		expect(profile.id).toBe("site-bot");
		expect(profile.systemPrompt).toContain("Site bot rule.");
	});

	it("keeps plain and unknown selectors on the generic path", () => {
		vi.stubEnv("CLINE_HUB_PROFILES_DIR", "");
		expect(resolveHubBotProfile(undefined)).toBe(PLAIN_BOT_PROFILE);
		expect(resolveHubBotProfile("cline")).toBe(PLAIN_BOT_PROFILE);
		expect(() => resolveHubBotProfile("not-a-real-profile")).toThrow(
			/Unknown bot profile/,
		);
	});
});
