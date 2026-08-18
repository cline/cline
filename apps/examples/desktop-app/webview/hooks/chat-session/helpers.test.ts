import { describe, expect, it } from "vitest";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import { resolveCredentialError } from "./helpers";

const CLOUD_CONFIG: ChatSessionConfig = {
	executionTarget: "cloud",
	provider: "cline",
	model: "anthropic/claude-sonnet-5",
	apiKey: "",
	workspaceRoot: "",
	cwd: "",
	repoUrl: "https://github.com/cline/cline",
} as ChatSessionConfig;

describe("resolveCredentialError (cloud)", () => {
	it("accepts a valid HTTPS GitHub URL for a new session", () => {
		expect(resolveCredentialError(CLOUD_CONFIG)).toBeNull();
	});

	it("rejects a partial URL even though the picker never confirmed it", () => {
		const error = resolveCredentialError({
			...CLOUD_CONFIG,
			repoUrl: "https://exa",
		});
		expect(error).toMatch(/valid HTTPS GitHub repository URL/);
	});

	it("rejects SSH and non-GitHub URLs", () => {
		for (const repoUrl of [
			"git@github.com:cline/cline.git",
			"https://gitlab.com/cline/cline",
			"http://github.com/cline/cline",
		]) {
			expect(resolveCredentialError({ ...CLOUD_CONFIG, repoUrl })).toMatch(
				/valid HTTPS GitHub repository URL/,
			);
		}
	});

	it("does not require a repo URL when sending into an existing session", () => {
		expect(
			resolveCredentialError(
				{ ...CLOUD_CONFIG, repoUrl: "" },
				{ hasActiveSession: true },
			),
		).toBeNull();
	});

	it("still requires the Cline provider for existing sessions", () => {
		expect(
			resolveCredentialError(
				{ ...CLOUD_CONFIG, provider: "anthropic" },
				{ hasActiveSession: true },
			),
		).toMatch(/Cline provider/);
	});
});
