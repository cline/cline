import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HubTransportContext } from "./context";
import { handleDriveHomeCommand } from "./drive-home-handlers";

const EXAMPLE_HOME = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../../../docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner",
);

function command(
	name: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		requestId: "req_home",
		clientId: "test",
		command: name,
		payload,
	};
}

function ctx(): HubTransportContext {
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish: () => {},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
}

async function seedPairPartnerHome(workspaceRoot: string): Promise<void> {
	const dest = join(workspaceRoot, ".driveagent", "pair-partner");
	await mkdir(dirname(dest), { recursive: true });
	await cp(EXAMPLE_HOME, dest, { recursive: true });
}

describe("handleDriveHomeCommand", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("requires workspaceRoot and slug", async () => {
		const missingRoot = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", { slug: "pair-partner" }),
		);
		expect(missingRoot.ok).toBe(false);
		expect(missingRoot.error?.code).toBe("invalid_payload");

		const missingSlug = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", { workspaceRoot: "/tmp" }),
		);
		expect(missingSlug.ok).toBe(false);
		expect(missingSlug.error?.code).toBe("invalid_payload");
	});

	it("returns unknown_agent when the home is missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-hub-"));
		dirs.push(root);

		const reply = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: root,
				slug: "missing-agent",
			}),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("unknown_agent");
	});

	it("loads and compiles the pair-partner example home", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-hub-"));
		dirs.push(root);
		await seedPairPartnerHome(root);

		const reply = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: root,
				slug: "pair-partner",
			}),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.home).toMatchObject({
			slug: "pair-partner",
			agent: { name: "pair-partner" },
			permissions: { presetIntent: "standard" },
		});
		expect(reply.payload?.compiled).toMatchObject({
			slug: "pair-partner",
			name: "pair-partner",
			tools: ["read_file", "write_file", "execute_command", "list_files"],
			skills: ["drive-persona", "drive-modes"],
		});
		expect(
			(reply.payload?.compiled as { systemPrompt?: string }).systemPrompt,
		).toMatch(/pair partner/i);
	});

	it("prefers workspace home over user home when both exist", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-hub-ws-"));
		dirs.push(root);

		const wsDir = join(root, ".driveagent", "pair-partner");
		await mkdir(wsDir, { recursive: true });
		await writeFile(
			join(wsDir, "agent.yaml"),
			[
				"name: pair-partner",
				"description: Workspace override pair partner.",
				"systemPrompt: Workspace-tier pair partner prompt.",
				"",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			join(wsDir, "permissions.yaml"),
			"presetIntent: readonly\n",
			"utf8",
		);
		await writeFile(
			join(wsDir, "env.yaml"),
			"values: {}\nsecretRefs: []\n",
			"utf8",
		);

		const reply = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: root,
				slug: "pair-partner",
			}),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.home).toMatchObject({
			permissions: { presetIntent: "readonly" },
		});
		expect(
			(reply.payload?.compiled as { systemPrompt?: string }).systemPrompt,
		).toMatch(/Workspace-tier/i);
	});
});
