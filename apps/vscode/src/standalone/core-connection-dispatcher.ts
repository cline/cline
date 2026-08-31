import type { Controller } from "@core/controller";
import { handleGrpcRequest } from "@core/controller/grpc-handler";
import { responseStreamingMethods } from "@generated/hosts/vscode/protobus-services";
import {
	type CoreConnectionMessageWriter,
	dispatchCoreConnectionRequest as dispatchProtocolRequest,
} from "./core-connection-protocol";

export async function dispatchCoreConnectionRequest(
	controller: Controller,
	write: CoreConnectionMessageWriter,
	request: Parameters<typeof dispatchProtocolRequest>[1],
): Promise<void> {
	await dispatchProtocolRequest(
		write,
		request,
		(qualifiedMethod) => responseStreamingMethods.has(qualifiedMethod),
		(postMessage, grpcRequest) =>
			handleGrpcRequest(controller, postMessage, grpcRequest),
	);
}
