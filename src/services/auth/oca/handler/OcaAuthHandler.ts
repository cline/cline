import type { IncomingMessage, Server, ServerResponse } from "node:http"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { HostProvider } from "@/hosts/host-provider"

const SERVER_TIMEOUT = 10 * 60 * 1000 // 10 minutes

/**
 * Handles OAuth authentication flow by creating a local server to receive tokens.
 */
export class OcaAuthHandler {
	private static instance: OcaAuthHandler | null = null

	private port = 0
	private server: Server | null = null
	private serverCreationPromise: Promise<void> | null = null
	private timeoutId: NodeJS.Timeout | null = null
	private enabled: boolean = false
	private _ports: number[] = []

	private constructor() {}

	/**
	 * Gets the singleton instance of AuthHandler
	 * @returns The singleton AuthHandler instance
	 */
	public static getInstance(): OcaAuthHandler {
		if (!OcaAuthHandler.instance) {
			OcaAuthHandler.instance = new OcaAuthHandler()
		}
		return OcaAuthHandler.instance
	}

	public setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}
	public set ports(ports: number[]) {
		this._ports = ports
	}

	public async getCallbackUri(): Promise<string> {
		if (!this.enabled) {
			throw Error("OcaAuthHandler was not enabled")
		}

		if (!this.server) {
			// If server creation is already in progress, wait for it
			if (this.serverCreationPromise) {
				await this.serverCreationPromise
			} else {
				// Start server creation and track the promise
				this.serverCreationPromise = this.createServer()
				await this.serverCreationPromise
			}
		} else {
			this.updateTimeout()
		}

		return `http://localhost:${this.port}/callback`
	}

	private async createServer(): Promise<void> {
		return new Promise(async (resolve, reject) => {
			try {
				const server = http.createServer(this.handleRequest.bind(this))

				// Try to bind on a port from the allowed range
				for (const port of this._ports) {
					try {
						await this.tryListenOnPort(server, port)

						const address = server.address()
						if (!address) {
							console.error("OcaAuthHandler: Failed to get server address")
							this.server = null
							this.port = 0
							this.serverCreationPromise = null
							reject(new Error("Failed to get server address"))
							return
						}

						// Get the assigned port and set up the server
						this.port = (address as AddressInfo).port
						this.server = server
						console.log("OcaAuthHandler: Server started on port", this.port)
						this.updateTimeout()
						this.serverCreationPromise = null

						// Attach a general error logger for visibility after successful bind
						server.on("error", (error) => {
							console.error("OcaAuthHandler: Server error", error)
						})

						resolve()
						return
					} catch (error) {
						const err = error as NodeJS.ErrnoException
						if (err?.code === "EADDRINUSE") {
							console.warn(`OcaAuthHandler: Port ${port} in use, trying next...`)
							continue
						}
						console.error("OcaAuthHandler: Server error", error)
						this.server = null
						this.port = 0
						this.serverCreationPromise = null
						reject(error)
						return
					}
				}

				// If we reach here, all ports in the range are occupied
				console.error(`OcaAuthHandler: No available port in range ${this._ports.map((port) => port)}`)
				this.server = null
				this.port = 0
				this.serverCreationPromise = null
				reject(new Error(`OcaAuthHandler: No available port in range ${this._ports.map((port) => port)}`))
			} catch (error) {
				console.error("OcaAuthHandler: Failed to create server", error)
				this.server = null
				this.port = 0
				this.serverCreationPromise = null
				reject(error)
			}
		})
	}

	private tryListenOnPort(server: Server, port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const onError = (error: NodeJS.ErrnoException) => {
				server.off("error", onError)
				reject(error)
			}
			server.once("error", onError)
			server.listen(port, "127.0.0.1", () => {
				server.off("error", onError)
				resolve()
			})
		})
	}

	private updateTimeout(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
		}

		this.timeoutId = setTimeout(() => this.stop(), SERVER_TIMEOUT)
		console.log("OcaAuthHandler: Idle timeout reset (ms)", SERVER_TIMEOUT)
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const vscodeBase = await HostProvider.get().getCallbackUri()
			let target = (vscodeBase.endsWith("/") ? vscodeBase : vscodeBase + "/") + "auth/oca"

			// Preserve original query string if present
			const idx = (req.url || "").indexOf("?")
			if (idx !== -1) {
				target += (req.url as string).substring(idx)
			}

			// Simple 302 redirect
			res.statusCode = 302
			res.setHeader("Location", target)
			res.end()
		} catch (error) {
			console.error("OcaAuthHandler: Error processing request", error)
			res.writeHead(500, { "Content-Type": "text/plain" })
			res.end("Internal Server Error")
		} finally {
			// Stop the server after handling the request
			this.stop()
		}
	}
	public stop(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
			this.timeoutId = null
		}

		if (this.server) {
			console.log("OcaAuthHandler: Closing server on port", this.port)
			this.server.close()
			this.server = null
			console.log("OcaAuthHandler: Server closed")
		} else {
			console.log("OcaAuthHandler: Stop called but server was not running")
		}

		this.serverCreationPromise = null
		this.port = 0
	}

	public dispose(): void {
		this.stop()
	}
}
