import {
	disableConnectorAutostart,
	getPersistedConnectorConnection,
	listActiveConnectors,
	persistConnectorConnection,
	removePersistedConnectorConnection,
} from "@cline/core";
import {
	CLINE_CONNECTOR_DETACHED_CHILD_ENV,
	CONNECT_ALREADY_RUNNING_EXIT_CODE,
} from "../connectors/common";
import { getConnector, listConnectors } from "../connectors/registry";
import type {
	ConnectIo,
	ConnectRunContext,
	ConnectStopResult,
} from "../connectors/types";

const HELP_FLAGS = new Set(["-h", "--help"]);
const INTERACTIVE_FLAGS = new Set(["-i", "--interactive"]);

export async function stopAllConnectors(
	io: ConnectIo,
): Promise<ConnectStopResult & { executed: number }> {
	let stoppedProcesses = 0;
	let failedProcesses = 0;
	let stoppedSessions = 0;
	let executed = 0;
	for (const entry of listConnectors()) {
		const connector = await getConnector(entry.name);
		if (!connector) {
			continue;
		}
		if (!connector.stopAll) {
			continue;
		}
		executed += 1;
		const result = await connector.stopAll(io);
		stoppedProcesses += result.stoppedProcesses;
		failedProcesses += result.failedProcesses;
		stoppedSessions += result.stoppedSessions;
	}
	return { stoppedProcesses, failedProcesses, stoppedSessions, executed };
}

export async function runStopAllConnectors(io: ConnectIo): Promise<number> {
	const { stoppedProcesses, failedProcesses, stoppedSessions, executed } =
		await stopAllConnectors(io);
	if (executed === 0) {
		io.writeln("[connect] no adapters support stop yet");
		return 0;
	}
	disableConnectorAutostart();
	io.writeln(
		`[connect] stopped processes=${stoppedProcesses} failed=${failedProcesses} sessions=${stoppedSessions}`,
	);
	return failedProcesses === 0 ? 0 : 1;
}

export async function runStopConnector(
	adapterName: string,
	io: ConnectIo,
	options: {
		autostart: "disable" | "preserve";
		instanceId?: string;
	} = {
		autostart: "disable",
	},
): Promise<number> {
	const connector = await getConnector(adapterName);
	if (!connector) {
		io.writeErr(`unknown connect adapter "${adapterName}"`);
		return 1;
	}
	const stop = options.instanceId
		? connector.stopInstance
			? () => connector.stopInstance?.(options.instanceId ?? "", io)
			: undefined
		: connector.stopAll
			? () => connector.stopAll?.(io)
			: undefined;
	if (!stop) {
		io.writeErr(`connect adapter "${adapterName}" does not support stop`);
		return 1;
	}
	const result = await stop();
	if (!result) {
		io.writeErr(`connect adapter "${adapterName}" does not support stop`);
		return 1;
	}
	if (options.autostart === "disable") {
		disableConnectorAutostart(connector.name, options.instanceId);
	}
	io.writeln(
		`[connect] ${connector.name}${options.instanceId ? ` instance=${options.instanceId}` : ""} stopped processes=${result.stoppedProcesses} failed=${result.failedProcesses} sessions=${result.stoppedSessions}`,
	);
	return result.failedProcesses === 0 ? 0 : 1;
}

export async function runRestartConnector(
	adapterName: string,
	passthroughArgs: string[],
	io: ConnectIo,
	requestedInstanceId?: string,
): Promise<number> {
	if (passthroughArgs.some((arg) => HELP_FLAGS.has(arg))) {
		return await runConnectAdapter(adapterName, passthroughArgs, io);
	}
	const connector = await getConnector(adapterName);
	if (!connector) {
		io.writeErr(`unknown connect adapter "${adapterName}"`);
		return 1;
	}
	const activeInstances = listActiveConnectors().filter(
		(record) => record.type === adapterName,
	);
	if (!requestedInstanceId && activeInstances.length > 1) {
		io.writeErr(
			`cannot safely restart ${adapterName}: ${activeInstances.length} instances are active; specify an instance`,
		);
		return 1;
	}
	const instanceId = requestedInstanceId ?? activeInstances[0]?.instanceId;
	const targetIsActive =
		instanceId !== undefined &&
		activeInstances.some((record) => record.instanceId === instanceId);
	if (!targetIsActive || !instanceId) {
		return await runConnectAdapter(adapterName, passthroughArgs, io);
	}

	const validationExitCode = await connector.validate(passthroughArgs, io);
	if (validationExitCode !== 0) {
		return validationExitCode;
	}
	const previousConnection = getPersistedConnectorConnection(
		adapterName,
		instanceId,
	);
	const stopExitCode = await runStopConnector(adapterName, io, {
		autostart: "preserve",
		instanceId,
	});
	if (stopExitCode !== 0) {
		return stopExitCode;
	}
	const replacement = await runConnectAdapterWithResult(
		adapterName,
		passthroughArgs,
		io,
	);
	if (replacement.exitCode === 0) {
		if (replacement.instanceId && replacement.instanceId !== instanceId) {
			removePersistedConnectorConnection(adapterName, instanceId);
		}
		return 0;
	}
	if (replacement.exitCode === CONNECT_ALREADY_RUNNING_EXIT_CODE) {
		io.writeErr(
			`[connect] replacement was not started because ${adapterName} instance ${instanceId} is still running`,
		);
		return 1;
	}
	if (!previousConnection) {
		io.writeErr(
			`[connect] replacement failed and ${adapterName} instance ${instanceId} has no successful launch arguments for rollback`,
		);
		return replacement.exitCode;
	}

	io.writeErr(
		`[connect] replacement failed; restoring ${adapterName} instance ${instanceId}`,
	);
	const rollback = await runConnectAdapterWithResult(
		adapterName,
		previousConnection.lastSuccessfulArgs,
		io,
	);
	if (rollback.exitCode === 0) {
		io.writeln(`[connect] restored ${adapterName} instance ${instanceId}`);
	} else {
		io.writeErr(
			`[connect] failed to restore ${adapterName} instance ${instanceId}`,
		);
	}
	return replacement.exitCode;
}

interface ConnectAdapterResult {
	exitCode: number;
	instanceId?: string;
}

async function runConnectAdapterWithResult(
	adapterName: string,
	passthroughArgs: string[],
	io: ConnectIo,
): Promise<ConnectAdapterResult> {
	const connector = await getConnector(adapterName);
	if (!connector) {
		io.writeErr(`unknown connect adapter "${adapterName}"`);
		return { exitCode: 1 };
	}
	let persistenceArgs = passthroughArgs;
	let persistenceInstanceId: string | undefined;
	const context: ConnectRunContext = {
		setPersistenceArgs: (args) => {
			persistenceArgs = [...args];
		},
		setPersistenceInstanceId: (instanceId) => {
			persistenceInstanceId = instanceId;
		},
	};
	const exitCode = await connector.run(passthroughArgs, io, context);
	if (exitCode === CONNECT_ALREADY_RUNNING_EXIT_CODE) {
		return { exitCode, instanceId: persistenceInstanceId };
	}
	const isHelpInvocation = passthroughArgs.some((arg) => HELP_FLAGS.has(arg));
	const isInteractiveInvocation = passthroughArgs.some((arg) =>
		INTERACTIVE_FLAGS.has(arg),
	);
	const isDetachedChild =
		process.env[CLINE_CONNECTOR_DETACHED_CHILD_ENV] === "1";
	if (
		exitCode === 0 &&
		!isHelpInvocation &&
		!isDetachedChild &&
		isInteractiveInvocation
	) {
		disableConnectorAutostart(connector.name, persistenceInstanceId);
	} else if (
		exitCode === 0 &&
		!isHelpInvocation &&
		!isDetachedChild &&
		persistenceInstanceId
	) {
		persistConnectorConnection(
			connector.name,
			persistenceInstanceId,
			persistenceArgs,
		);
	}
	return { exitCode, instanceId: persistenceInstanceId };
}

export async function runConnectAdapter(
	adapterName: string,
	passthroughArgs: string[],
	io: ConnectIo,
): Promise<number> {
	const result = await runConnectAdapterWithResult(
		adapterName,
		passthroughArgs,
		io,
	);
	return result.exitCode === CONNECT_ALREADY_RUNNING_EXIT_CODE
		? 0
		: result.exitCode;
}

export function formatAdapterList(): string {
	const lines: string[] = [];
	for (const connector of listConnectors()) {
		lines.push(`  ${connector.name.padEnd(12)} ${connector.description}`);
	}
	return lines.join("\n");
}
