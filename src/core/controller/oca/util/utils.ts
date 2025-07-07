import { name, version } from "../../../../../package.json"
import * as vscode from "vscode"
import { jwtDecode, type JwtPayload } from "jwt-decode"

/**
 * Generates a compliant customer opc-request-id segment.
 *
 * Format (32 hex):
 *   [token hash (8)] [taskId hash (8)] [timestamp (8)] [random (8)]
 * - token hash:    first 4 bytes of SHA-256(token)
 * - taskId hash:   first 4 bytes of SHA-256(taskId)
 * - timestamp:     Unix seconds since epoch, 8 hex digits
 * - random:        strong random, 8 hex digits
 *
 * Use: Send this single value as the opc-request-id header.
 */
export async function generateOpcRequestId(taskId: string, token: string): Promise<string> {
	async function hash8(str: string): Promise<string> {
		const data = new TextEncoder().encode(str)
		const hash = await crypto.subtle.digest("SHA-256", data)
		return Array.from(new Uint8Array(hash).slice(0, 4))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
	}

	const [tokenHex, taskHex] = await Promise.all([hash8(token), hash8(taskId)])
	const timestampHex = Math.floor(Date.now() / 1000)
		.toString(16)
		.padStart(8, "0")

	function randomHex8(): string {
		const arr = new Uint32Array(1)
		crypto.getRandomValues(arr)
		return arr[0].toString(16).padStart(8, "0")
	}

	// Compose: token(8) + task(8) + time(8) + rnd(8) = 32 hex
	return tokenHex + taskHex + timestampHex + randomHex8()
}

/**
 * Create headers for OCA requests
 */

export async function createOcaHeaders(accessToken: string, taskId: string): Promise<Record<string, string>> {
	const opcRequestId = await generateOpcRequestId(taskId, accessToken)

	return {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		client: "Cline",
		"client-version": `${name}-${version}`,
		"client-ide": vscode.env.appName,
		"client-ide-version": vscode.version,
		"opc-request-id": opcRequestId,
	}
}

/**
 * Decodes a JWT payload without validation and returns the 'sub' claim.
 * Use only for non-security, informational, or display purposes.
 * @param token JWT string
 */
export function parseJwtPayload(token: string): JwtPayload | null {
	try {
		const payload = jwtDecode(token)
		return payload
	} catch {
		return null
	}
}
