import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	DriveagentHomeLoadError,
	loadDriveagentHome,
} from "./load";

const EXAMPLE_HOME = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../../docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner",
);

describe("loadDriveagentHome", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads workspace .driveagent/<slug>/", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-load-"));
		dirs.push(root);
		const dest = join(root, ".driveagent", "pair-partner");
		await mkdir(dirname(dest), { recursive: true });
		await cp(EXAMPLE_HOME, dest, { recursive: true });

		const loaded = loadDriveagentHome({
			workspaceRoot: root,
			slug: "pair-partner",
		});
		expect(loaded.tier).toBe("workspace");
		expect(loaded.home.slug).toBe("pair-partner");
		expect(loaded.home.agent.tools).toEqual([
			"read_file",
			"write_file",
			"execute_command",
			"list_files",
		]);
	});

	it("falls back to ~/.driveagent/<slug>/ when workspace home is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-load-ws-"));
		const userHome = await mkdtemp(join(tmpdir(), "drive-home-load-user-"));
		dirs.push(root, userHome);

		const userAgentDir = join(userHome, ".driveagent", "pair-partner");
		await mkdir(dirname(userAgentDir), { recursive: true });
		await cp(EXAMPLE_HOME, userAgentDir, { recursive: true });

		const loaded = loadDriveagentHome({
			workspaceRoot: root,
			slug: "pair-partner",
			userHomeDir: userHome,
		});
		expect(loaded.tier).toBe("user");
		expect(loaded.home.slug).toBe("pair-partner");
	});

	it("throws unknown_agent for missing slug homes", () => {
		expect(() =>
			loadDriveagentHome({
				workspaceRoot: tmpdir(),
				slug: "no-such-agent",
			}),
		).toThrow(DriveagentHomeLoadError);

		try {
			loadDriveagentHome({
				workspaceRoot: tmpdir(),
				slug: "Not Valid",
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(DriveagentHomeLoadError);
			if (error instanceof DriveagentHomeLoadError) {
				expect(error.code).toBe("unknown_agent");
			}
		}
	});
});
