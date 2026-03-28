function browserOnlyError(): Error {
	return new Error(
		"@clinebot/rpc is Node-only. Use @clinebot/rpc/node in Node runtimes.",
	);
}

export class RpcSessionClient {
	constructor() {
		throw browserOnlyError();
	}
}
export type { RpcStreamTeamProgressHandlers } from "./client";

export class RpcRuntimeChatClient {
	constructor() {
		throw browserOnlyError();
	}
}

export async function runRpcRuntimeEventBridge(): Promise<never> {
	throw browserOnlyError();
}
export async function runRpcRuntimeCommandBridge(): Promise<never> {
	throw browserOnlyError();
}

export type {
	RpcRuntimeEvent,
	RpcRuntimeStreamStop,
} from "./client/runtime-chat-client";
export type {
	RpcRuntimeBridgeCommand,
	RpcRuntimeBridgeCommandOutputLine,
	RpcRuntimeBridgeRequestEnvelope,
	RpcRuntimeBridgeResponseEnvelope,
} from "./client/runtime-chat-command-bridge";
export type {
	RpcRuntimeBridgeControlLine,
	RpcRuntimeBridgeOutputLine,
} from "./client/runtime-chat-stream-bridge";

export function getRpcServerHandle(): never {
	throw browserOnlyError();
}

export async function getRpcServerHealth(): Promise<never> {
	throw browserOnlyError();
}

export async function registerRpcClient(): Promise<never> {
	throw browserOnlyError();
}

export async function requestRpcServerShutdown(): Promise<never> {
	throw browserOnlyError();
}

export async function startRpcServer(_options: unknown): Promise<never> {
	throw browserOnlyError();
}

export async function stopRpcServer(): Promise<never> {
	throw browserOnlyError();
}

export function getRpcServerDefaultAddress(): never {
	throw browserOnlyError();
}

export type {
	PendingApproval,
	RoutedEvent,
	RpcClientRegistrationInput,
	RpcClientRegistrationResult,
	RpcRuntimeHandlers,
	RpcScheduleExecution,
	RpcScheduleExecutionStatus,
	RpcScheduleMode,
	RpcScheduleRecord,
	RpcServerHandle,
	RpcServerOptions,
	RpcSessionBackend,
	RpcSessionRow,
	RpcSessionStatus,
	RpcSessionUpdateInput,
	RpcSpawnQueueItem,
} from "./types";
