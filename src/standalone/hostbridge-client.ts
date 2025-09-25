import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"
import { log } from "./utils"

export const HOSTBRIDGE_PORT = 26041

export async function waitForHostBridgeReady(timeoutMs = 60000, intervalMs = 500): Promise<void> {
	const address = process.env.HOST_BRIDGE_ADDRESS || `localhost:${HOSTBRIDGE_PORT}`
	const client = createHealthClient(address)
	const deadline = Date.now() + timeoutMs
	try {
		while (Date.now() < deadline) {
			const ok = await checkHealthOnce(client)
			if (ok) {
				log(`HostBridge serving at ${address}; continuing startup`)
				return
			}
			log("Waiting for hostbridge to be ready...")
			await new Promise((r) => setTimeout(r, intervalMs))
		}
	} finally {
		client.close()
	}
	log("HostBridge health check timed out")
	process.exit(1)
}

// Client-side health check for the hostbridge service (kept at bottom for clarity)
const SERVING_STATUS = 1
function createHealthClient(address: string) {
	const healthDef = protoLoader.loadSync(health.protoPath)
	const grpcObj = grpc.loadPackageDefinition(healthDef) as unknown as any
	const Health = grpcObj.grpc.health.v1.Health
	return new Health(address, grpc.credentials.createInsecure())
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
