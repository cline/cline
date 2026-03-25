import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolveRpcProtoPath } from "../proto/resolve-proto-path.js";
import type { ProtoGrpcType } from "./proto-types.js";

export const PACKAGE_NAME = "cline.rpc.v1";
export const SERVICE_NAME = "ClineGateway";

export function parseAddress(address: string): { host: string; port: number } {
	const trimmed = address.trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx <= 0 || idx >= trimmed.length - 1) {
		throw new Error(`Invalid RPC address: ${address}`);
	}
	const host = trimmed.slice(0, idx);
	const port = Number.parseInt(trimmed.slice(idx + 1), 10);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`Invalid RPC port in address: ${address}`);
	}
	return { host, port };
}

function resolveProtoPath(): string {
	return resolveRpcProtoPath(import.meta.url);
}

export function loadGatewayService(): grpc.ServiceDefinition {
	const packageDef = protoLoader.loadSync(resolveProtoPath(), {
		keepCase: false,
		longs: String,
		enums: String,
		defaults: true,
		oneofs: true,
	});
	const loaded = grpc.loadPackageDefinition(
		packageDef,
	) as unknown as ProtoGrpcType;
	const service = loaded.cline?.rpc?.v1?.ClineGateway?.service;
	if (!service) {
		throw new Error(
			`Unable to load ${PACKAGE_NAME}.${SERVICE_NAME} from proto`,
		);
	}
	return service;
}
