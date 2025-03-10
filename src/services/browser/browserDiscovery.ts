import * as vscode from "vscode"
import * as os from "os"
import * as net from "net"
import axios from "axios"

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
		console.log(`Trying to connect to Chrome at: http://${ipAddress}:9222/json/version`)
		const response = await axios.get(`http://${ipAddress}:9222/json/version`, { timeout: 1000 })
		const data = response.data
		return { endpoint: data.webSocketDebuggerUrl, ip: ipAddress }
	} catch (error) {
		return null
	}
}

/**
 * Execute a shell command and return stdout and stderr
 */
export async function executeShellCommand(command: string): Promise<{ stdout: string; stderr: string }> {
	return new Promise<{ stdout: string; stderr: string }>((resolve) => {
		const cp = require("child_process")
		cp.exec(command, (err: any, stdout: string, stderr: string) => {
			resolve({ stdout, stderr })
		})
	})
}

/**
 * Get Docker gateway IP without UI feedback
 */
export async function getDockerGatewayIP(): Promise<string | null> {
	try {
		if (process.platform === "linux") {
			try {
				const { stdout } = await executeShellCommand("ip route | grep default | awk '{print $3}'")
				return stdout.trim()
			} catch (error) {
				console.log("Could not determine Docker gateway IP:", error)
			}
		}
		return null
	} catch (error) {
		console.log("Could not determine Docker gateway IP:", error)
		return null
	}
}

/**
 * Get Docker host IP
 */
export async function getDockerHostIP(): Promise<string | null> {
	try {
		// Try to resolve host.docker.internal (works on Docker Desktop)
		return new Promise((resolve) => {
			const dns = require("dns")
			dns.lookup("host.docker.internal", (err: any, address: string) => {
				if (err) {
					resolve(null)
				} else {
					resolve(address)
				}
			})
		})
	} catch (error) {
		console.log("Could not determine Docker host IP:", error)
		return null
	}
}

/**
 * Scan a network range for Chrome debugging port
 */
export async function scanNetworkForChrome(baseIP: string): Promise<string | null> {
	if (!baseIP || !baseIP.match(/^\d+\.\d+\.\d+\./)) {
		return null
	}

	// Extract the network prefix (e.g., "192.168.65.")
	const networkPrefix = baseIP.split(".").slice(0, 3).join(".") + "."

	// Common Docker host IPs to try first
	const priorityIPs = [
		networkPrefix + "1", // Common gateway
		networkPrefix + "2", // Common host
		networkPrefix + "254", // Common host in some Docker setups
	]

	console.log(`Scanning priority IPs in network ${networkPrefix}*`)

	// Check priority IPs first
	for (const ip of priorityIPs) {
		const isOpen = await isPortOpen(ip, 9222)
		if (isOpen) {
			console.log(`Found Chrome debugging port open on ${ip}`)
			return ip
		}
	}

	return null
}

/**
 * Discover Chrome instances on the network
 */
export async function discoverChromeInstances(): Promise<string | null> {
	// Get all network interfaces
	const networkInterfaces = os.networkInterfaces()
	const ipAddresses = []

	// Always try localhost first
	ipAddresses.push("localhost")
	ipAddresses.push("127.0.0.1")

	// Try to get Docker gateway IP (headless mode)
	const gatewayIP = await getDockerGatewayIP()
	if (gatewayIP) {
		console.log("Found Docker gateway IP:", gatewayIP)
		ipAddresses.push(gatewayIP)
	}

	// Try to get Docker host IP
	const hostIP = await getDockerHostIP()
	if (hostIP) {
		console.log("Found Docker host IP:", hostIP)
		ipAddresses.push(hostIP)
	}

	// Add all local IP addresses from network interfaces
	const localIPs: string[] = []
	Object.values(networkInterfaces).forEach((interfaces) => {
		if (!interfaces) return
		interfaces.forEach((iface) => {
			// Only consider IPv4 addresses
			if (iface.family === "IPv4" || iface.family === (4 as any)) {
				localIPs.push(iface.address)
			}
		})
	})

	// Add local IPs to the list
	ipAddresses.push(...localIPs)

	// Scan network for Chrome debugging port
	for (const ip of localIPs) {
		const chromeIP = await scanNetworkForChrome(ip)
		if (chromeIP && !ipAddresses.includes(chromeIP)) {
			console.log("Found potential Chrome host via network scan:", chromeIP)
			ipAddresses.push(chromeIP)
		}
	}

	// Remove duplicates
	const uniqueIPs = [...new Set(ipAddresses)]
	console.log("IP Addresses to try:", uniqueIPs)

	// Try connecting to each IP address
	for (const ip of uniqueIPs) {
		const connection = await tryConnect(ip)
		if (connection) {
			console.log(`Successfully connected to Chrome at: ${connection.ip}`)
			// Store the successful IP for future use
			console.log(`✅ Found Chrome at ${connection.ip} - You can hardcode this IP if needed`)

			// Return the host URL and endpoint
			return `http://${connection.ip}:9222`
		}
	}

	return null
}

/**
 * Test connection to a remote browser
 */
export async function testBrowserConnection(
	host: string,
): Promise<{ success: boolean; message: string; endpoint?: string }> {
	try {
		// Fetch the WebSocket endpoint from the Chrome DevTools Protocol
		const versionUrl = `${host.replace(/\/$/, "")}/json/version`
		console.log(`Testing connection to ${versionUrl}`)

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
