import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { ClineGatewayClient } from "./proto/generated/cline/rpc/v1/ClineGateway";
import type { ProtoGrpcType } from "./proto/generated/rpc";
import { resolveRpcProtoPath } from "./proto/resolve-proto-path";

const PACKAGE_NAME = "cline.rpc.v1";
const SERVICE_NAME = "ClineGateway";

function resolveProtoPath(): string {
	return resolveRpcProtoPath(import.meta.url);
}

function loadGatewayService(): grpc.ServiceDefinition {
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

export function createGatewayGenericClient(
	address: string,
): ClineGatewayClient {
	const ctor = grpc.makeGenericClientConstructor(
		loadGatewayService(),
		SERVICE_NAME,
	) as unknown as new (
		endpoint: string,
		credentials: grpc.ChannelCredentials,
	) => ClineGatewayClient;
	return new ctor(address, grpc.credentials.createInsecure());
}
