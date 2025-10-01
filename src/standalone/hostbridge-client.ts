import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"
import { log } from "./utils"

export const HOSTBRIDGE_PORT = 26041

export async function waitForHostBridgeReady(timeoutMs = 60000, intervalMs = 500): Promise<string> {
	const address = process.env.HOST_BRIDGE_ADDRESS || `127.0.0.1:${HOSTBRIDGE_PORT}`
	const client = createHealthClient(address)
	const deadline = Date.now() + timeoutMs
	try {
		while (Date.now() < deadline) {
			const ok = await checkHealthOnce(client)
			if (ok) {
				log(`HostBridge serving at ${address}; continuing startup`)
				return address
			}
			log("Waiting for hostbridge to be ready...")
			await new Promise((r) => setTimeout(r, intervalMs))
		}
	} finally {
		client.close()
	}
	throw new Error(`HostBridge health check timed out after ${timeoutMs}ms`)
}

// Client-side health check for the hostbridge service (kept at bottom for clarity)
const SERVING_STATUS = 1
function createHealthClient(address: string) {
	const healthDef = protoLoader.loadSync(health.protoPath)
	const grpcObj = grpc.loadPackageDefinition(healthDef) as unknown as any
	const Health = grpcObj.grpc.health.v1.Health
	const opts: grpc.ChannelOptions = { "grpc.enable_http_proxy": 0 }
	return new Health(address, grpc.credentials.createInsecure(), opts)
}

async function checkHealthOnce(client: any): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		client.check({ service: "" }, (err: unknown, resp: any) => {
			if (err) {
				console.debug(err.toString())
				return resolve(false)
			}
			return resolve(resp?.status === SERVING_STATUS)
		})
	})
}
