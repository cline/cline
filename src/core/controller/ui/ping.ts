import { Controller } from ".."
import { PingRequest } from "@shared/proto/cline/ui"
import { KeyValuePair } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Handles ping requests for measuring gRPC latency with variable payload sizes
 * @param controller The controller instance
 * @param request The request containing timestamp and payload size
 * @returns KeyValuePair with payload data - latency calculated on frontend
 */
export async function ping(controller: Controller, request: PingRequest): Promise<KeyValuePair> {
	// Add artificial 1-second delay to prove async/await works
	// (This helps users understand that the latency measurement is real)

	// Generate payload of requested size (default to 1KB if not specified)
	const payloadSizeKB = request.payloadSizeKb || 1
	const payloadSizeBytes = payloadSizeKB * 1024

	// Create payload string of specified size
	const payload = "x".repeat(payloadSizeBytes)

	// Log to both console and output channel for debugging
	console.log(`🏓 gRPC PING received - ${payloadSizeKB}KB payload (after 1s delay)`)
	HostProvider.get().logToChannel(`🏓 gRPC PING received - ${payloadSizeKB}KB payload (after 1s delay)`)

	return KeyValuePair.create({
		key: `pong-${payloadSizeKB}kb`,
		value: payload, // Return the large payload to test transfer speed
	})
}
