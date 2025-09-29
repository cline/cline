import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"
import { SqliteLockManager } from "@/core/locks/SqliteLockManager"
import { log } from "./utils"

const SERVING_STATUS = 1

interface PortCheckResult {
	canProceed: boolean
	error?: string
}

interface RegistryEntry {
	instanceAddress: string
	hostAddress: string
}

/**
 * Creates a gRPC health client for the given address
 */
function createHealthClient(address: string): any {
	const healthDef = protoLoader.loadSync(health.protoPath)
	const grpcObj = grpc.loadPackageDefinition(healthDef) as unknown as any
	const Health = grpcObj.grpc.health.v1.Health
	return new Health(address, grpc.credentials.createInsecure())
}

/**
 * Performs a single health check on the given address
 */
async function checkHealthOnce(address: string): Promise<{ success: boolean; status?: number; error?: Error }> {
	const client = createHealthClient(address)

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			try {
				client.close?.()
			} catch {}
			resolve({ success: false, error: new Error("Health check timeout") })
		}, 5000) // 5 second timeout

		client.check({ service: "" }, (err: unknown, resp: any) => {
			clearTimeout(timeout)
			try {
				client.close?.()
			} catch {}

			if (err) {
				resolve({ success: false, error: err as Error })
			} else {
				resolve({ success: true, status: resp?.status })
			}
		})
	})
}

/**
 * Attempts to shut down a host bridge instance
 */
async function shutdownHostBridge(hostAddress: string): Promise<boolean> {
	try {
		log(`Attempting to shutdown host bridge at ${hostAddress}`)

		// This would need to be implemented - we need a way to send shutdown to a specific host
		// For now, we'll just log that we would do this
		log(`Would send shutdown command to host bridge at ${hostAddress}`)

		return true
	} catch (error) {
		log(`Failed to shutdown host bridge at ${hostAddress}: ${error}`)
		return false
	}
}

/**
 * Checks if a port is available for binding, following the registry-first approach
 */
export async function checkPortAvailability(port: number, lockManager: SqliteLockManager): Promise<PortCheckResult> {
	log(`Checking port availability for port ${port}`)

	// Step 1: Check registry first
	const registryEntry = lockManager.getInstanceByPort(port)

	if (!registryEntry) {
		log(`No registry entry found for port ${port}, free to bind`)
		return { canProceed: true }
	}

	log(`Found registry entry for port ${port}: instance=${registryEntry.instanceAddress}, host=${registryEntry.hostAddress}`)

	// Step 2: Perform health check on the registered instance
	const coreAddress = registryEntry.instanceAddress

	const performHealthCheck = async (): Promise<{ success: boolean; status?: number; error?: Error }> => {
		return await checkHealthOnce(coreAddress)
	}

	// First health check attempt
	let healthResult = await performHealthCheck()

	if (!healthResult.success) {
		// Health check ERROR - not our process
		log(`Health check failed for ${coreAddress}: ${healthResult.error?.message}`)
		log(`This indicates a non-Cline process is using port ${port}`)

		// Attempt to shutdown the registered host bridge
		const shutdownSuccess = await shutdownHostBridge(registryEntry.hostAddress)
		if (shutdownSuccess) {
			log(`Successfully requested shutdown of host bridge ${registryEntry.hostAddress}`)
		}

		// Remove from registry
		lockManager.removeInstanceByAddress(registryEntry.instanceAddress)
		log(`Removed stale registry entry for ${registryEntry.instanceAddress}`)

		return {
			canProceed: false,
			error: `Port ${port} is occupied by a non-Cline process. Registry has been cleaned up.`,
		}
	}

	// Health check succeeded - it's our process
	if (healthResult.status === SERVING_STATUS) {
		// Healthy Cline instance already running
		log(`Healthy Cline instance already running on port ${port}`)
		return {
			canProceed: false,
			error: `A healthy Cline instance is already running on port ${port}`,
		}
	}

	// Health check succeeded but status is not SERVING - unhealthy Cline instance
	log(`Unhealthy Cline instance detected on port ${port} (status: ${healthResult.status}), retrying in 1 second`)

	// Wait 1 second and retry
	await new Promise((resolve) => setTimeout(resolve, 1000))

	// Second health check attempt
	healthResult = await performHealthCheck()

	if (!healthResult.success) {
		// Now it's erroring - something changed
		log(`Health check now failing after retry for ${coreAddress}: ${healthResult.error?.message}`)

		// Clean up registry since the instance is no longer responding
		lockManager.removeInstanceByAddress(registryEntry.instanceAddress)
		log(`Removed non-responsive registry entry for ${registryEntry.instanceAddress}`)

		return {
			canProceed: false,
			error: `Port ${port} had an unhealthy Cline instance that is now non-responsive. Registry cleaned up.`,
		}
	}

	if (healthResult.status === SERVING_STATUS) {
		// Instance recovered
		log(`Cline instance on port ${port} has recovered and is now healthy`)
		return {
			canProceed: false,
			error: `Cline instance on port ${port} has recovered and is now serving`,
		}
	}

	// Still unhealthy after retry
	log(`Cline instance on port ${port} remains unhealthy after retry (status: ${healthResult.status})`)
	return {
		canProceed: false,
		error: `Cline instance on port ${port} is unhealthy and did not recover after retry`,
	}
}
