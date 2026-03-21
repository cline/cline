import { getConnector, listConnectors } from "../connectors/registry";
import type { ConnectIo, ConnectStopResult } from "../connectors/types";

export async function runStopAllConnectors(io: ConnectIo): Promise<number> {
	let stoppedProcesses = 0;
	let stoppedSessions = 0;
	let executed = 0;
	for (const connector of listConnectors()) {
		if (!connector.stopAll) {
			continue;
		}
		executed += 1;
		const result = await connector.stopAll(io);
		stoppedProcesses += result.stoppedProcesses;
		stoppedSessions += result.stoppedSessions;
	}
	if (executed === 0) {
		io.writeln("[connect] no adapters support stop yet");
		return 0;
	}
	io.writeln(
		`[connect] stopped processes=${stoppedProcesses} sessions=${stoppedSessions}`,
	);
	return 0;
}

export async function runStopConnector(
	adapterName: string,
	io: ConnectIo,
): Promise<number> {
	const connector = getConnector(adapterName);
	if (!connector) {
		io.writeErr(`unknown connect adapter "${adapterName}"`);
		return 1;
	}
	if (!connector.stopAll) {
		io.writeErr(`connect adapter "${adapterName}" does not support stop`);
		return 1;
	}
	const result: ConnectStopResult = await connector.stopAll(io);
	io.writeln(
		`[connect] ${connector.name} stopped processes=${result.stoppedProcesses} sessions=${result.stoppedSessions}`,
	);
	return 0;
}

export async function runConnectAdapter(
	adapterName: string,
	passthroughArgs: string[],
	io: ConnectIo,
): Promise<number> {
	const connector = getConnector(adapterName);
	if (!connector) {
		io.writeErr(`unknown connect adapter "${adapterName}"`);
		return 1;
	}
	return connector.run(passthroughArgs, io);
}

export function formatAdapterList(): string {
	const lines: string[] = [];
	for (const connector of listConnectors()) {
		lines.push(`  ${connector.name.padEnd(12)} ${connector.description}`);
	}
	return lines.join("\n");
}
