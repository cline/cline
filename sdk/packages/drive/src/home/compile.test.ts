import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	parseDriveagentAgentYaml,
	parseDriveagentEnvYaml,
	parseDriveagentHome,
	parseDriveagentPermissionsYaml,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	compileDriveagentHome,
	DriveagentHomeCompileError,
} from "./compile.js";

const EXAMPLE_HOME = join(
	import.meta.dirname,
	"../../../../../docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner",
);

/** Vitest runs under Node; parse fixture YAML via the Bun CLI (`Bun.YAML`). */
function loadYaml(fileName: string): unknown {
	const path = join(EXAMPLE_HOME, fileName);
	const result = spawnSync(
		"bun",
		[
			"-e",
			"const text = await Bun.file(process.argv[1]).text(); process.stdout.write(JSON.stringify(Bun.YAML.parse(text)));",
			path,
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(
			`Failed to parse ${fileName} with Bun.YAML: ${result.stderr || result.stdout}`,
		);
	}
	return JSON.parse(result.stdout) as unknown;
}

describe("compileDriveagentHome", () => {
	it("compiles the pair-partner example home without throwing", () => {
		const home = parseDriveagentHome({
			slug: "pair-partner",
			agent: parseDriveagentAgentYaml(loadYaml("agent.yaml")),
			permissions: parseDriveagentPermissionsYaml(
				loadYaml("permissions.yaml"),
			),
			env: parseDriveagentEnvYaml(loadYaml("env.yaml")),
		});
		const view = compileDriveagentHome(home);
		expect(view.slug).toBe("pair-partner");
		expect(view.name).toBe("pair-partner");
		expect(view.description.length).toBeGreaterThan(0);
		expect(view.tools).toEqual([
			"read_file",
			"write_file",
			"execute_command",
			"list_files",
		]);
		expect(view.skills).toEqual(["drive-persona", "drive-modes"]);
		expect(view.systemPrompt).toMatch(/pair partner/i);
	});

	it("throws a clear error for an unknown / invalid home", () => {
		expect(() => compileDriveagentHome(null)).toThrow(
			DriveagentHomeCompileError,
		);
		expect(() => compileDriveagentHome({})).toThrow(/slug/);
		expect(() =>
			compileDriveagentHome({
				slug: "missing-agent",
				permissions: { presetIntent: "standard" },
				env: { values: {}, secretRefs: [] },
			}),
		).toThrow(/missing agent/);

		try {
			compileDriveagentHome({ slug: "Not Valid" });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(DriveagentHomeCompileError);
			if (error instanceof DriveagentHomeCompileError) {
				expect(error.code).toBe("unknown_agent");
			}
		}
	});
});
