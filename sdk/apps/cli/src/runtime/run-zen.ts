import type { UserInstructionConfigWatcher } from "@clinebot/core";
import { HubSessionClient } from "@clinebot/hub";
import type { ChatStartSessionRequest } from "@clinebot/shared";
import { ensureCliHubServer } from "../utils/hub-runtime";
import { c, emitJsonLine, writeErr, writeln } from "../utils/output";
import type { Config } from "../utils/types";
import { buildUserInputMessage } from "./prompt";

const ZEN_DISPATCH_ACK_TIMEOUT_MS = 5_000;

/**
 * Zen mode: fire-and-forget dispatch of a task to the background hub.
 *
 * Unlike a normal CLI run, zen mode does not stay connected to watch the
 * session stream. It submits the turn to the hub and exits immediately. The
 * hub continues to execute the agent loop in the background and, on
 * completion, already publishes a `ui.notify` event which the menubar app
 * (if installed) surfaces as a system notification. If the menubar app is not
 * running, users can still find the result later via `clite history`.
 *
 * Because no human is available to approve tool calls once the CLI exits,
 * zen mode forces full tool auto-approval (same semantics as yolo) and only
 * works with a hub-backed session. Sandbox mode is incompatible with zen
 * because sandbox requires a local backend that terminates with the CLI.
 */
export async function runZen(
	prompt: string,
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<void> {
	if (config.sandbox) {
		writeErr(
			"--zen cannot be combined with --sandbox (sandbox requires a local backend).",
		);
		process.exitCode = 1;
		return;
	}
	if (
		process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase() === "local"
	) {
		writeErr(
			"--zen requires the hub backend but CLINE_SESSION_BACKEND_MODE=local is set.",
		);
		process.exitCode = 1;
		return;
	}

	const workspaceRoot = config.workspaceRoot ?? config.cwd;
	let hubUrl: string;
	try {
		hubUrl = await ensureCliHubServer(workspaceRoot);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeErr(`failed to start background hub: ${message}`);
		process.exitCode = 1;
		return;
	}

	const sessionClient = new HubSessionClient({
		address: hubUrl,
		clientType: "cli-zen",
		displayName: "Cline CLI (zen)",
		workspaceRoot,
		cwd: config.cwd,
	});

	let sessionId: string | undefined;
	try {
		await sessionClient.connect();

		const {
			prompt: userInput,
			userImages,
			userFiles,
		} = await buildUserInputMessage(prompt, userInstructionWatcher);

		const startRequest: ChatStartSessionRequest = {
			workspaceRoot,
			cwd: config.cwd,
			provider: config.providerId,
			model: config.modelId,
			apiKey: config.apiKey || undefined,
			systemPrompt: config.systemPrompt,
			// Zen runs unattended: use yolo-style tool behavior so tool calls are
			// auto-approved without a human in the loop.
			mode: "yolo",
			rules: undefined,
			maxIterations: config.maxIterations,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: true,
			source: "cline-cli-zen",
			interactive: false,
			logger: config.loggerConfig,
		};

		const started = await sessionClient.startRuntimeSession(startRequest);
		sessionId = started.sessionId;

		// Wait for the hub to acknowledge `session.send_input` before closing the
		// socket. That confirms the prompt frame reached the hub and was accepted
		// for execution, avoiding silent drops on slow or loaded systems.
		await Promise.race([
			sessionClient.sendRuntimeSession(started.sessionId, {
				config: startRequest,
				prompt: userInput,
				attachments:
					userImages.length > 0 || userFiles.length > 0
						? {
								userImages: userImages.length > 0 ? userImages : undefined,
								userFiles:
									userFiles.length > 0
										? userFiles.map((content, index) => ({
												name: `attachment-${index + 1}`,
												content,
											}))
										: undefined,
							}
						: undefined,
			}),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(
						new Error(
							`timed out waiting for hub to acknowledge zen dispatch after ${ZEN_DISPATCH_ACK_TIMEOUT_MS} ms`,
						),
					);
				}, ZEN_DISPATCH_ACK_TIMEOUT_MS);
			}),
		]);

		if (config.outputMode === "json") {
			emitJsonLine("stdout", {
				type: "zen_dispatched",
				sessionId,
				hubUrl,
				workspaceRoot,
			});
		} else {
			writeln(
				`${c.dim}[zen]${c.reset} the CLI is exiting; the session ${sessionId} will continue running in the background.`,
			);
			writeln(
				`${c.dim}[zen]${c.reset} check ${c.dim} history${c.reset} later to see the result.`,
			);
		}
		process.exitCode = 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (config.outputMode === "json") {
			emitJsonLine("stderr", {
				type: "zen_error",
				sessionId,
				message,
			});
		} else {
			writeErr(`zen dispatch failed: ${message}`);
		}
		process.exitCode = 1;
	} finally {
		sessionClient.close();
	}
}
