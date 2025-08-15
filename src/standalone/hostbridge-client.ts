import * as grpc from "@grpc/grpc-js"
import * as health from "grpc-health-check"
import { log } from "./utils"
import * as protoLoader from "@grpc/proto-loader"
import { HOST_BRIDGE_PORT } from "@/hosts/external/host-bridge-client-manager"

// Client-side health check for the hostbridge service (kept at bottom for clarity)
function createHealthClient(address?: string) {
	const healthDef = protoLoader.loadSync(health.protoPath)
	const grpcObj = grpc.loadPackageDefinition(healthDef) as unknown as any
	const Health = grpcObj.grpc.health.v1.Health
	const target = address || process.env.HOST_BRIDGE_ADDRESS || `localhost:${HOST_BRIDGE_PORT}`
	return new Health(target, grpc.credentials.createInsecure())
}

// gRPC health check returns numeric status: 1 = SERVING
const SERVING_STATUS = 1
async function checkHealthOnce(client: any): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		client.check({ service: "" }, (err: unknown, resp: any) => {
			const errorMessage = (err && (err instanceof Error ? err.message : String(err))) || ""
			log("Hostbridge health check response:", resp || "", errorMessage)
			if (err) {
				return resolve(false)
			}
			return resolve(resp?.status === SERVING_STATUS)
		})
	})
}

export async function waitForHostBridgeReady(timeoutMs = 60000, intervalMs = 500, address?: string): Promise<void> {
	const client = createHealthClient(address)
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		// eslint-disable-next-line no-await-in-loop
		const ok = await checkHealthOnce(client)
		if (ok) {
			try {
				client.close?.()
			} catch {}
			return
		}
		log("Waiting for hostbridge to be ready...")
		// eslint-disable-next-line no-await-in-loop
		await new Promise((r) => setTimeout(r, intervalMs))
	}
	try {
		client.close?.()
	} catch {}
	throw new Error("HostBridge health check timed out")
}
