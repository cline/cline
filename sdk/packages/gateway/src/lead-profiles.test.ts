import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listLeadProfiles, loadLeadProfile } from "./lead-profiles";
import { loadPlugin } from "./plugins/loader";

const profileFile = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"default-agent",
	"cline-dad",
	"profile.json",
);

describe("built-in lead profiles", () => {
	it("keeps plain Cline and Cline Dad as distinct choices", () => {
		expect(
			listLeadProfiles([profileFile]).map((profile) => profile.id),
		).toEqual(["cline", "cline-dad"]);
	});

	it("renders Cline Dad rules and validates every Agent Plugin", () => {
		const profile = loadLeadProfile(profileFile, {
			ADMIN_NAME: "Bee",
			CLINE_HOME: "/opt/cline",
			PUBLIC_HOST: "cline.example.test",
		});
		expect(profile.systemPrompt).toContain("Bee");
		expect(profile.systemPrompt).not.toContain("{{ADMIN_NAME}}");
		expect(profile.systemPrompt).toContain("Cline Dad");
		expect(profile.systemPrompt).toContain("cline_doctor_report");
		expect(profile.pluginRoots).toHaveLength(2);
		for (const root of profile.pluginRoots) {
			const result = loadPlugin(root);
			expect(result.ok, root).toBe(true);
			if (result.ok && result.plugin.manifest.name !== "cline-dad.core") {
				expect(result.plugin.mcpServers).toHaveLength(1);
			}
		}
	});
});
