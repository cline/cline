import axios from "axios"
import * as net from "net"

/**
 * Check if a port is open on a given host
 */
export async function isPortOpen(host: string, port: number, timeout = 1000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new net.Socket()
		let status = false

		// Set timeout
		socket.setTimeout(timeout)

		// Handle successful connection
		socket.on("connect", () => {
			status = true
			socket.destroy()
		})

		// Handle any errors
		socket.on("error", () => {
			socket.destroy()
		})

		// Handle timeout
		socket.on("timeout", () => {
			socket.destroy()
		})

		// Handle close
		socket.on("close", () => {
			resolve(status)
		})

		// Attempt to connect
		socket.connect(port, host)
	})
}

/**
 * Try to connect to Chrome at a specific IP address
 */
export async function tryConnect(ipAddress: string): Promise<{ endpoint: string; ip: string } | null> {
	try {
		const response = await axios.get(`http://${ipAddress}:9222/json/version`, { timeout: 1000 })
		const data = response.data
		return { endpoint: data.webSocketDebuggerUrl, ip: ipAddress }
	} catch (_error) {
		return null
	}
}

/**
 * Discover Chrome instances (localhost only)
 */
export async function discoverChromeInstances(): Promise<string | null> {
	// Only try localhost
	const ipAddresses = ["localhost", "127.0.0.1"]

	// Try connecting to each IP address
	for (const ip of ipAddresses) {
		const connection = await tryConnect(ip)
		if (connection) {
			return `http://${connection.ip}:9222`
		}
	}

	return null
}

/**
 * Test connection to a remote browser
 */
export async function testBrowserConnection(host: string): Promise<{ success: boolean; message: string; endpoint?: string }> {
	try {
		// Fetch the WebSocket endpoint from the Chrome DevTools Protocol
		const versionUrl = `${host.replace(/\/$/, "")}/json/version`

		const response = await axios.get(versionUrl, { timeout: 3000 })
		const browserWSEndpoint = response.data.webSocketDebuggerUrl

		if (!browserWSEndpoint) {
			return {
				success: false,
				message: "Could not find webSocketDebuggerUrl in the response",
			}
		}

		return {
			success: true,
			message: "Successfully connected to Chrome browser",
			endpoint: browserWSEndpoint,
		}
	} catch (error) {
		console.error(`Failed to connect to remote browser: ${error}`)
		return {
			success: false,
			message: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}
