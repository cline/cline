import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { writeDesktopSettings } from "./desktop-settings";
import type { SidecarContext } from "./types";

export function localRuntimeContext(
	sessionManager: Record<string, unknown>,
	options: { sessionIds?: string[]; workspaceRoot?: string } = {},
) {
	const workspaceRoot = options.workspaceRoot ?? "/workspace";
	return {
		runtimeBindings: new Map([
			[
				"local",
				{
					environmentId: "local",
					kind: "local" as const,
					workspaceRoot,
					sessionManager,
					hubClient: {
						command: vi.fn(async () => undefined),
					},
					unsubscribeSessionEvents: () => {},
				},
			],
		]),
		sessionEnvironmentIds: new Map(
			(options.sessionIds ?? []).map((sessionId) => [sessionId, "local"]),
		),
		activeEnvironmentId: "local",
		remoteEnvironments: null,
		localWorkspaceRoot: workspaceRoot,
	};
}

export function localSessionManager(
	ctx: SidecarContext,
): Record<string, unknown> {
	return ctx.runtimeBindings.get("local")?.sessionManager as unknown as Record<
		string,
		unknown
	>;
}

const handoffOptInDataDirs: string[] = [];

export function enableCloudHandoffGates(): void {
	const dataDir = mkdtempSync(join(tmpdir(), "cline-handoff-optin-"));
	handoffOptInDataDirs.push(dataDir);
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_CODE_CLOUD_AGENTS = "1";
	writeDesktopSettings({ cloudSessionsEnabled: true });
}

export function cleanupCloudHandoffGates(): void {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_DATA_DIR;
	for (const dataDir of handoffOptInDataDirs.splice(0)) {
		rmSync(dataDir, { recursive: true, force: true });
	}
}
