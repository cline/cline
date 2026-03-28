import * as grpc from "@grpc/grpc-js";
import type {
	RpcClientRegistrationInput,
	RpcClientRegistrationResult,
} from "../types";
import { loadGatewayService, SERVICE_NAME } from "./grpc-service";
import { safeString } from "./helpers";
import type {
	HealthRequest,
	HealthResponse,
	RegisterClientResponse,
	ShutdownRequest,
	ShutdownResponse,
} from "./proto-types";

type ClineGatewayHealthClient = grpc.Client & {
	Health: (
		request: HealthRequest,
		callback: (
			error: grpc.ServiceError | null,
			response: HealthResponse | undefined,
		) => void,
	) => void;
	Shutdown: (
		request: ShutdownRequest,
		callback: (
			error: grpc.ServiceError | null,
			response: ShutdownResponse | undefined,
		) => void,
	) => void;
	RegisterClient: (
		request: {
			clientId?: string;
			clientType?: string;
			metadata?: Record<string, string>;
		},
		callback: (
			error: grpc.ServiceError | null,
			response: RegisterClientResponse | undefined,
		) => void,
	) => void;
};

function createGatewayClient(address: string): ClineGatewayHealthClient {
	const ctor = grpc.makeGenericClientConstructor(
		loadGatewayService(),
		SERVICE_NAME,
	) as unknown as new (
		address: string,
		credentials: grpc.ChannelCredentials,
	) => ClineGatewayHealthClient;
	return new ctor(address, grpc.credentials.createInsecure());
}

export async function getRpcServerHealth(
	address: string,
): Promise<HealthResponse | undefined> {
	return await new Promise<HealthResponse | undefined>((resolve) => {
		let client: ClineGatewayHealthClient | undefined;
		try {
			client = createGatewayClient(address);
		} catch {
			resolve(undefined);
			return;
		}
		client.Health({}, (error, response) => {
			client?.close();
			if (error || !response) {
				resolve(undefined);
				return;
			}
			resolve(response);
		});
	});
}

export async function requestRpcServerShutdown(
	address: string,
): Promise<ShutdownResponse | undefined> {
	return await new Promise<ShutdownResponse | undefined>((resolve) => {
		let client: ClineGatewayHealthClient | undefined;
		try {
			client = createGatewayClient(address);
		} catch {
			resolve(undefined);
			return;
		}
		client.Shutdown({}, (error, response) => {
			client?.close();
			if (error || !response) {
				resolve(undefined);
				return;
			}
			resolve(response);
		});
	});
}

export async function registerRpcClient(
	address: string,
	input: RpcClientRegistrationInput,
): Promise<RpcClientRegistrationResult | undefined> {
	return await new Promise<RpcClientRegistrationResult | undefined>(
		(resolve) => {
			let client: ClineGatewayHealthClient | undefined;
			try {
				client = createGatewayClient(address);
			} catch {
				resolve(undefined);
				return;
			}
			client.RegisterClient(
				{
					clientId: input.clientId,
					clientType: input.clientType,
					metadata: input.metadata ?? {},
				},
				(error, response) => {
					client?.close();
					if (error || !response) {
						resolve(undefined);
						return;
					}
					resolve({
						clientId: safeString(response.clientId).trim(),
						registered: response.registered === true,
					});
				},
			);
		},
	);
}
