import * as net from "net"
import axios from "axios"
import * as dns from "dns"

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
export async function tryChromeHostUrl(chromeHostUrl: string): Promise<boolean> {
	try {
		console.log(`Trying to connect to Chrome at: ${chromeHostUrl}/json/version`)
		await axios.get(`${chromeHostUrl}/json/version`, { timeout: 1000 })
		return true
	} catch (error) {
		return false
	}
}

/**
 * Get Docker host IP
 */
export async function getDockerHostIP(): Promise<string | null> {
	try {
		// Try to resolve host.docker.internal (works on Docker Desktop)
		return new Promise((resolve) => {
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
export async function scanNetworkForChrome(baseIP: string, port: number): Promise<string | null> {
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
		const isOpen = await isPortOpen(ip, port)
		if (isOpen) {
			console.log(`Found Chrome debugging port open on ${ip}`)
			return ip
		}
	}

	return null
}

// Function to discover Chrome instances on the network
const discoverChromeHosts = async (port: number): Promise<string | null> => {
	// Get all network interfaces
	const ipAddresses = []

	// Try to get Docker host IP
	const hostIP = await getDockerHostIP()
	if (hostIP) {
		console.log("Found Docker host IP:", hostIP)
		ipAddresses.push(hostIP)
	}

	// Remove duplicates
	const uniqueIPs = [...new Set(ipAddresses)]
	console.log("IP Addresses to try:", uniqueIPs)

	// Try connecting to each IP address
	for (const ip of uniqueIPs) {
		const hostEndpoint = `http://${ip}:${port}`

		const hostIsValid = await tryChromeHostUrl(hostEndpoint)
		if (hostIsValid) {
			// Store the successful IP for future use
			console.log(`✅ Found Chrome at ${hostEndpoint}`)

			// Return the host URL and endpoint
			return hostEndpoint
		}
	}

	return null
}

/**
 * Test connection to a remote browser debugging websocket.
 * First tries specific hosts, then attempts auto-discovery if needed.
 * @param browserHostUrl Optional specific host URL to check first
 * @param port Browser debugging port (default: 9222)
 * @returns WebSocket debugger URL if connection is successful, null otherwise
 */
export async function discoverChromeHostUrl(port: number = 9222): Promise<string | null> {
	// First try specific hosts
	const hostsToTry = [`http://localhost:${port}`, `http://127.0.0.1:${port}`]

	// Try each host directly first
	for (const hostUrl of hostsToTry) {
		console.log(`Trying to connect to: ${hostUrl}`)
		try {
			const hostIsValid = await tryChromeHostUrl(hostUrl)
			if (hostIsValid) return hostUrl
		} catch (error) {
			console.log(`Failed to connect to ${hostUrl}: ${error instanceof Error ? error.message : error}`)
		}
	}

	// If direct connections failed, attempt auto-discovery
	console.log("Direct connections failed. Attempting auto-discovery...")

	const discoveredHostUrl = await discoverChromeHosts(port)
	if (discoveredHostUrl) {
		console.log(`Trying to connect to discovered host: ${discoveredHostUrl}`)
		try {
			const hostIsValid = await tryChromeHostUrl(discoveredHostUrl)
			if (hostIsValid) return discoveredHostUrl
			console.log(`Failed to connect to discovered host ${discoveredHostUrl}`)
		} catch (error) {
			console.log(`Error connecting to discovered host: ${error instanceof Error ? error.message : error}`)
		}
	} else {
		console.log("No browser instances discovered on network")
	}

	return null
}
