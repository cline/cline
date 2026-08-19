import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listLeadProfiles, loadLeadProfile } from "./lead-profiles";
import { loadPlugin } from "./plugins/loader";

const profileFile = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"default-agent",
	"cline-mom",
	"profile.json",
);

describe("built-in lead profiles", () => {
	it("keeps plain Cline and Cline Mom as distinct choices", () => {
		expect(
			listLeadProfiles([profileFile]).map((profile) => profile.id),
		).toEqual(["cline", "cline-mom"]);
	});

	it("renders Cline Mom rules and validates every Agent Plugin", () => {
		const profile = loadLeadProfile(profileFile, {
			ADMIN_NAME: "Bee",
			CLINE_HOME: "/opt/cline",
			PUBLIC_HOST: "cline.example.test",
		});
		expect(profile.systemPrompt).toContain("Bee");
		expect(profile.systemPrompt).toContain("/opt/cline");
		expect(profile.systemPrompt).not.toContain("{{ADMIN_NAME}}");
		expect(profile.pluginRoots).toHaveLength(6);
		expect(profile.systemPrompt).toContain("cline-plugin-authoring");
		for (const root of profile.pluginRoots) {
			const result = loadPlugin(root);
			expect(result.ok, root).toBe(true);
			if (result.ok && result.plugin.manifest.name !== "cline-mom.core") {
				expect(result.plugin.mcpServers).toHaveLength(1);
			}
		}
	});
});
