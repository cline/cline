import {
	type AgentHooks,
	ComputerBackendRestart,
	ComputerTaskArtifactRecorder,
	ComputerUseClient,
	createComputerBackendRestartTool,
	createComputerUseTool,
	createJournalEventSink,
	createTranscriptRecordingHooks,
	isComputerUseLoopbackHost,
	resolveComputerUseBackendCommandFromEnv,
	resolveComputerUseTargetFromEnv,
} from "@cline/core";
import type { AgentTool } from "@cline/shared";
import { nanoid } from "nanoid";
import type { Config } from "../../utils/types";

export interface InteractiveComputerUse {
	driverTools: AgentTool[];
	/** Hooks to merge into the driver session's config for journal observability. */
	driverRecordingHooks: AgentHooks;
	dispose(): Promise<void>;
}

/** CLI host for the raw computer tool, backend recovery, and driver observability. */
export async function createInteractiveComputerUse(input: {
	config: Config;
	env?: NodeJS.ProcessEnv;
}): Promise<InteractiveComputerUse | undefined> {
	// The backend target and launch command are a startup snapshot. Changing
	// either requires a new CLI session; provider settings do not affect them.
	const env = input.env ?? process.env;
	const target = resolveComputerUseTargetFromEnv(env);
	if (!target) {
		return undefined;
	}

	// The backend serves a single agent connection at a time. Share its client
	// between the tool, recovery probes, and journal publisher rather than
	// opening competing sockets. The backend journals computer actions itself,
	// so a client-side action observer would duplicate those events.
	const computerClient = new ComputerUseClient(target);
	const journalSink = createJournalEventSink(computerClient);
	const recorder = new ComputerTaskArtifactRecorder(
		`task_${nanoid(10)}`,
		journalSink,
	);
	const command = resolveComputerUseBackendCommandFromEnv(env);
	const backendRestart =
		command && isComputerUseLoopbackHost(target.host)
			? new ComputerBackendRestart({
					...target,
					command,
					cwd: input.config.cwd,
					client: computerClient,
				})
			: undefined;
	const disposeComputerUse = async () => {
		await recorder.flush().catch(() => {});
		// Only release a backend this host spawned. Recovery borrows the shared
		// client; this host closes it even when backend cleanup fails.
		try {
			await journalSink.dispose();
		} finally {
			try {
				await backendRestart?.dispose();
			} finally {
				computerClient.close();
			}
		}
	};

	try {
		if (backendRestart) {
			const startup = await backendRestart.ensureRunning();
			if (startup.status === "failed_to_start") {
				throw new Error(
					`Computer-use backend failed to start: ${startup.error}`,
				);
			}
		}
		const computerTool = await createComputerUseTool({
			...target,
			client: computerClient,
			backendAvailability: backendRestart,
		});
		return {
			driverTools: [
				computerTool,
				...(backendRestart
					? [createComputerBackendRestartTool(backendRestart)]
					: []),
			],
			driverRecordingHooks: createTranscriptRecordingHooks(recorder, {
				kind: "driver",
			}),
			dispose: disposeComputerUse,
		};
	} catch (error) {
		try {
			await disposeComputerUse();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Computer-use startup failed and cleanup also failed",
			);
		}
		throw error;
	}
}
