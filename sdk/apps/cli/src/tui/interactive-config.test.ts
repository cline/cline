import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadInteractiveConfigData } from "./interactive-config";

describe("interactive config agent listing", () => {
	const envSnapshot = {
		CLINE_DIR: process.env.CLINE_DIR,
	};

	afterEach(() => {
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
	});

	it("lists configured agents even when their tool names are unsupported", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-interactive-config-"));
		const workspaceRoot = join(tempRoot, "workspace");
		const globalAgentsDir = join(tempRoot, ".cline", "agents");
		const workspaceAgentsDir = join(workspaceRoot, ".cline", "agents");

		await mkdir(globalAgentsDir, { recursive: true });
		await mkdir(workspaceAgentsDir, { recursive: true });

		try {
			process.env.CLINE_DIR = join(tempRoot, ".cline");

			await writeFile(
				join(globalAgentsDir, "subagent.yml"),
				`---
name: subagent
description: legacy global config
tools: execute_command, write_to_file
---
Legacy global agent.`,
			);

			await writeFile(
				join(workspaceAgentsDir, "reviewer.yml"),
				`---
name: reviewer
description: legacy workspace config
tools: execute_command, read_file
---
Legacy workspace agent.`,
			);

			const config = await loadInteractiveConfigData({
				cwd: workspaceRoot,
				workspaceRoot,
				availabilityContext: { mode: "act" },
			});

			expect(config.agents.map((agent) => agent.name)).toEqual([
				"reviewer",
				"subagent",
			]);
			expect(config.agents.map((agent) => agent.path)).toEqual([
				join(workspaceAgentsDir, "reviewer.yml"),
				join(globalAgentsDir, "subagent.yml"),
			]);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});
