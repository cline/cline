import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClineCore } from "@cline/core";

interface LocalCloudWorkerInput {
	workspace: string;
	prompt: string;
	rolePrompt: string;
	runId: string;
}

function requireString(
	value: unknown,
	field: keyof LocalCloudWorkerInput,
): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`local cloud worker requires ${field}`);
	}
	return value;
}

async function readInput(): Promise<LocalCloudWorkerInput> {
	const raw = readFileSync(0, "utf8");
	const parsed = JSON.parse(raw) as Partial<LocalCloudWorkerInput>;
	return {
		workspace: resolve(requireString(parsed.workspace, "workspace")),
		prompt: requireString(parsed.prompt, "prompt"),
		rolePrompt: requireString(parsed.rolePrompt, "rolePrompt"),
		runId: requireString(parsed.runId, "runId"),
	};
}

async function main(): Promise<void> {
	const input = await readInput();
	const providerId =
		process.env.LOCAL_CLOUD_AGENT_PROVIDER?.trim() || "claude-code";
	const modelId = process.env.LOCAL_CLOUD_AGENT_MODEL?.trim() || "sonnet";
	const apiKey = process.env.LOCAL_CLOUD_AGENT_API_KEY?.trim();
	const cline = await ClineCore.create({
		clientName: "local-cloud-agent-worker",
		backendMode: "local",
		toolPolicies: { "*": { autoApprove: true } },
	});

	try {
		const started = await cline.start({
			prompt: input.prompt,
			config: {
				providerId,
				modelId,
				...(apiKey ? { apiKey } : {}),
				cwd: input.workspace,
				workspaceRoot: input.workspace,
				systemPrompt: `${input.rolePrompt}\n\nYou are a cloud teammate working inside a hydrated, task-scoped workspace. Work only with files in this workspace. Complete the delegated task and return a concise result to the parent agent.`,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				mode: "act",
				yolo: true,
				maxIterations: 24,
				toolPolicies: { "*": { autoApprove: true } },
				extensionContext: {
					client: {
						name: "local-cloud-agent-worker",
						version: "local",
						platform: "cli",
						platformVersion: "local",
						isMultiRoot: false,
					},
					workspace: {
						rootPath: input.workspace,
						cwd: input.workspace,
						workspaceName: "local-cloud-workspace",
						ide: "Local Cloud Worker",
						platform: process.platform,
					},
				},
			},
			interactive: false,
			source: "local-cloud-agent-worker",
			sessionMetadata: { localCloudRunId: input.runId },
		});
		const result = started.result;
		if (!result) {
			throw new Error("local cloud worker returned without a result");
		}
		process.stdout.write(
			JSON.stringify({
				text: result.text,
				usage: result.usage,
				messages: [],
				toolCalls: result.toolCalls,
				iterations: result.iterations,
				finishReason: result.finishReason,
				model: result.model,
				startedAt: result.startedAt,
				endedAt: result.endedAt,
				durationMs: result.durationMs,
			}),
		);
	} finally {
		await cline.dispose("local_cloud_worker_complete");
	}
}

await main().catch((error: unknown) => {
	const message =
		error instanceof Error ? error.message : "unknown worker error";
	process.stderr.write(`Local cloud worker failed: ${message}\n`);
	process.exitCode = 1;
});
