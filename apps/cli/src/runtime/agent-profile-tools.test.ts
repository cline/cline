import { describe, expect, it } from "vitest";
import { resolveAgentProfileDisabledToolNames } from "./agent-profile-tools";

describe("resolveAgentProfileDisabledToolNames", () => {
	it("returns undefined without a profile", () => {
		expect(resolveAgentProfileDisabledToolNames(undefined)).toBeUndefined();
	});

	it("returns undefined when the profile has no tools restriction", () => {
		expect(
			resolveAgentProfileDisabledToolNames({ skills: ["review-pr"] }),
		).toBeUndefined();
	});

	it("disables catalog tools outside the allowlist, resolving legacy aliases", () => {
		const disabled = resolveAgentProfileDisabledToolNames({
			tools: ["Read_File", "search_codebase"],
		});
		expect(disabled).toBeDefined();
		expect(disabled).toContain("run_commands");
		expect(disabled).toContain("fetch_web_content");
		expect(disabled).toContain("editor");
		expect(disabled).toContain("skills");
		expect(disabled).toContain("spawn_agent");
		expect(disabled).not.toContain("read_files");
		expect(disabled).not.toContain("search_codebase");
	});

	it("never disables harness tools outside the catalog", () => {
		const disabled = resolveAgentProfileDisabledToolNames({ tools: [] });
		expect(disabled).toBeDefined();
		expect(disabled).not.toContain("submit_and_exit");
		expect(disabled).not.toContain("attempt_completion");
	});

	it("implicitly allows the skills tool when the profile lists skills", () => {
		const disabled = resolveAgentProfileDisabledToolNames({
			tools: ["read_files"],
			skills: ["review-pr"],
		});
		expect(disabled).toBeDefined();
		expect(disabled).not.toContain("skills");
	});

	it("keeps both routed editor tool names enabled when the editor is allowed", () => {
		for (const modelId of ["anthropic/claude-sonnet-4.6", "openai/gpt-5.2"]) {
			const disabled = resolveAgentProfileDisabledToolNames(
				{ tools: ["editor"] },
				{ providerId: modelId.split("/")[0], modelId, mode: "act" },
			);
			expect(disabled).toBeDefined();
			expect(disabled).not.toContain("editor");
			expect(disabled).not.toContain("apply_patch");
		}
	});

	it("accepts runtime tool names like apply_patch for routed catalog entries", () => {
		for (const modelId of ["anthropic/claude-sonnet-4.6", "openai/gpt-5.2"]) {
			const disabled = resolveAgentProfileDisabledToolNames(
				{ tools: ["apply_patch", "read_files"] },
				{ providerId: modelId.split("/")[0], modelId, mode: "act" },
			);
			expect(disabled).toBeDefined();
			expect(disabled).not.toContain("apply_patch");
			expect(disabled).toContain("run_commands");
		}
	});
});
