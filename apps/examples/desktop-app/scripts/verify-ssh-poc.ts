import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ClineCore,
	ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	resolveProviderApiKeyFromSettings,
	SessionSource,
	toProviderConfig,
} from "@cline/core";
import { RemoteEnvironmentService } from "../sidecar/remote-environments";

const required = (name: string): string => {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
};

async function main(): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "cline-ssh-proof-"));
	const service = new RemoteEnvironmentService({
		profilesPath: join(temporaryDirectory, "remote-environments.json"),
		helperBinaryPath: required("CLINE_SSH_TEST_HELPER"),
		knownHostsPath: join(temporaryDirectory, "known_hosts"),
		commandTimeoutMs: 60_000,
		uploadTimeoutMs: 5 * 60_000,
	});
	let core: ClineCore | undefined;

	try {
		const helperPath = required("CLINE_SSH_TEST_HELPER");
		const workspaceRoot = required("CLINE_SSH_TEST_WORKSPACE");
		const profile = await service.upsert({
			name: "SSH proof host",
			host: required("CLINE_SSH_TEST_HOST"),
			user: process.env.CLINE_SSH_TEST_USER?.trim() || undefined,
			identityFile: required("CLINE_SSH_TEST_KEY"),
		});
		const connection = await service.connect(profile.id);
		const marker = await service.run(profile.id, {
			command: "sed",
			args: ["-n", "1p", "REMOTE_MARKER.txt"],
			cwd: workspaceRoot,
		});

		const providerSettings = new ProviderSettingsManager();
		const stored = providerSettings.read();
		const providerId = stored.lastUsedProvider;
		if (!providerId)
			throw new Error("No configured desktop provider is available");
		const settings = providerSettings.getProviderSettings(providerId);
		if (!settings)
			throw new Error(`No settings found for provider ${providerId}`);
		const modelId = settings.model || "meta/muse-spark-1.2";
		const providerConfig = {
			...toProviderConfig(
				{ ...settings, model: modelId },
				{ includeKnownModels: false },
			),
		};
		delete providerConfig.refreshToken;
		const oauth = await new RuntimeOAuthTokenManager({
			providerSettingsManager: providerSettings,
		}).resolveProviderApiKey({ providerId });
		const apiKey =
			oauth?.apiKey ||
			resolveProviderApiKeyFromSettings(providerSettings, providerId);
		if (!apiKey)
			throw new Error(`No credential found for provider ${providerId}`);

		core = await ClineCore.create({
			clientName: "cline-code",
			backendMode: "remote",
			remote: {
				endpoint: connection.endpoint,
				authToken: connection.authToken,
				workspaceRoot: connection.workspaceRoot,
				cwd: connection.workspaceRoot,
				clientType: "code-sidecar-ssh",
			},
		});
		const eventNames: string[] = [];
		const unsubscribe = core.subscribe((event) => {
			eventNames.push(event.type);
		});
		const started = await core.start({
			config: {
				providerId,
				modelId,
				apiKey,
				providerConfig,
				workspaceRoot,
				cwd: workspaceRoot,
				systemPrompt: "",
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			source: SessionSource.DESKTOP,
			interactive: true,
			toolPolicies: { "*": { autoApprove: true } },
		});
		const result = await core.send({
			sessionId: started.sessionId,
			prompt:
				"Read REMOTE_MARKER.txt from this workspace with the file-reading tool, then reply with its exact contents. Do not change any files.",
		});
		const sessions = await core.list(20, { hydrate: false });
		const messages = await core.readMessages(started.sessionId);
		unsubscribe();
		await core.dispose("desktop_ssh_proof_reconnect");
		core = undefined;
		await service.disconnect(profile.id);

		const reconnected = await service.connect(profile.id);
		core = await ClineCore.create({
			clientName: "cline-code",
			backendMode: "remote",
			remote: {
				endpoint: reconnected.endpoint,
				authToken: reconnected.authToken,
				workspaceRoot: reconnected.workspaceRoot,
				cwd: reconnected.workspaceRoot,
				clientType: "code-sidecar-ssh",
			},
		});
		const sessionsAfterReconnect = await core.list(20, { hydrate: false });
		const messagesAfterReconnect = await core.readMessages(started.sessionId);

		const resultText = result?.text ?? "";
		const report = {
			connected: true,
			remote: `${connection.platform}/${connection.arch}`,
			connectionRoot: connection.workspaceRoot,
			workspaceRoot: started.manifest.workspace_root,
			sessionId: started.sessionId,
			listContainsSession: sessions.some(
				(session) => session.sessionId === started.sessionId,
			),
			messageCount: messages.length,
			reconnected: true,
			reconnectListContainsSession: sessionsAfterReconnect.some(
				(session) => session.sessionId === started.sessionId,
			),
			reconnectMessageCount: messagesAfterReconnect.length,
			helperBytes: (await stat(helperPath)).size,
			sshMarker: marker.stdout.trim(),
			agentText: resultText,
			agentObservedMarker: resultText.includes("remote workspace proof"),
			eventNames: [...new Set(eventNames)],
		};
		if (
			report.sshMarker !== "remote workspace proof" ||
			!report.agentObservedMarker ||
			!report.listContainsSession ||
			!report.reconnectListContainsSession ||
			report.messageCount < 2 ||
			report.reconnectMessageCount < 2 ||
			!report.eventNames.includes("agent_event")
		) {
			throw new Error(`SSH proof failed: ${JSON.stringify(report)}`);
		}
		process.stdout.write(`${JSON.stringify(report)}\n`);
	} finally {
		await core?.dispose("desktop_ssh_proof_complete");
		await service.dispose();
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
