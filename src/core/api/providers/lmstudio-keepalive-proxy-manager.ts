import { ChildProcess, fork } from "child_process"
import { existsSync } from "fs"
import net, { AddressInfo } from "net"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"

const DEFAULT_PROXY_PORT = 1234
const DEFAULT_TARGET_HOST = "127.0.0.1"
const DEFAULT_HEARTBEAT_MS = 25_000

interface ProxyConfig {
	proxyPort: number
	targetPort: number
	targetHost: string
	targetProtocol: "http" | "https"
	heartbeatMs: number
}

type ProxyProcessMessage =
	| {
			type: "ready"
			port: number
	  }
	| {
			type: "error"
			code?: string
			message: string
	  }

export class LmStudioKeepAliveProxyManager {
	private static instance: LmStudioKeepAliveProxyManager | null = null

	private child: ChildProcess | null = null
	private startPromise: Promise<void> | null = null
	private currentConfig: ProxyConfig | null = null
	private desiredConfig: ProxyConfig | null = null
	private activeProxyPort: number | null = null
	private lastPortNotificationKey: string | null = null

	private constructor() {
		process.once("exit", () => {
			void this.stopProxy()
		})
	}

	public static getInstance(): LmStudioKeepAliveProxyManager {
		if (!LmStudioKeepAliveProxyManager.instance) {
			LmStudioKeepAliveProxyManager.instance = new LmStudioKeepAliveProxyManager()
		}
		return LmStudioKeepAliveProxyManager.instance
	}

	public isRunning(): boolean {
		return this.child !== null
	}

	public async ensureProxyRunning(baseUrl: string | undefined): Promise<void> {
		const config = await this.buildConfig(baseUrl)

		if (this.startPromise && this.desiredConfig && this.configEquals(this.desiredConfig, config)) {
			try {
				await this.startPromise
			} finally {
				if (this.startPromise === null) {
					this.desiredConfig = null
				}
			}
			return
		}

		// Already running with identical configuration
		if (this.child && this.currentConfig && this.configEquals(this.currentConfig, config)) {
			return
		}

		if (this.child) {
			await this.stopProxy()
		}

		this.desiredConfig = config
		const launchPromise = this.launchProxyProcess(config)
		this.startPromise = launchPromise

		try {
			await launchPromise
			this.activeProxyPort = config.proxyPort
			if (config.proxyPort !== config.targetPort) {
				await this.notifyProxyPortChange(config.targetPort, config.proxyPort)
			}
		} finally {
			if (this.startPromise === launchPromise) {
				this.startPromise = null
			}
			this.desiredConfig = null
		}
	}

	public async stopProxy(): Promise<void> {
		const child = this.child
		this.child = null
		this.currentConfig = null
		this.desiredConfig = null
		this.activeProxyPort = null
		this.lastPortNotificationKey = null

		if (child) {
			await new Promise<void>((resolve) => {
				const handleExit = () => resolve()
				child.once("exit", handleExit)
				try {
					child.kill()
				} catch {
					resolve()
				}
				// Safety timer in case the process refuses to exit
				const timeout = setTimeout(resolve, 1_000)
				if (typeof (timeout as NodeJS.Timeout).unref === "function") {
					;(timeout as NodeJS.Timeout).unref()
				}
			})
		}

		if (this.startPromise) {
			try {
				await this.startPromise.catch(() => undefined)
			} finally {
				this.startPromise = null
			}
		}
	}

	private async buildConfig(baseUrl: string | undefined): Promise<ProxyConfig> {
		let preferredProxyPort = DEFAULT_PROXY_PORT
		let targetPort = DEFAULT_PROXY_PORT
		let targetHost = DEFAULT_TARGET_HOST
		let targetProtocol: "http" | "https" = "http"

		if (baseUrl) {
			try {
				const parsed = new URL(baseUrl)
				targetHost = parsed.hostname || DEFAULT_TARGET_HOST
				targetProtocol = parsed.protocol === "https:" ? "https" : "http"
				const parsedPort =
					parsed.port !== ""
						? Number.parseInt(parsed.port, 10)
						: parsed.protocol === "https:"
							? 443
							: DEFAULT_PROXY_PORT
				if (!Number.isNaN(parsedPort) && parsedPort > 0) {
					preferredProxyPort = parsedPort
					targetPort = parsedPort
				}
			} catch (error) {
				console.warn("LM Studio keep-alive proxy: failed to parse base URL, using defaults:", error)
			}
		}

		const proxyPort = await this.findAvailablePort(preferredProxyPort)

		const heartbeatOverride = process.env.LMSTUDIO_KEEP_ALIVE_HEARTBEAT_MS
		const heartbeatMs =
			heartbeatOverride && !Number.isNaN(Number.parseInt(heartbeatOverride, 10))
				? Number.parseInt(heartbeatOverride, 10)
				: DEFAULT_HEARTBEAT_MS

		return {
			proxyPort,
			targetPort,
			targetHost,
			targetProtocol,
			heartbeatMs,
		}
	}

	private configEquals(a: ProxyConfig, b: ProxyConfig): boolean {
		return (
			a.proxyPort === b.proxyPort &&
			a.targetPort === b.targetPort &&
			a.targetHost === b.targetHost &&
			a.targetProtocol === b.targetProtocol &&
			a.heartbeatMs === b.heartbeatMs
		)
	}

	private getProxyScriptPath(): string | null {
		try {
			if (!HostProvider.isInitialized()) {
				return null
			}
			const extensionPath = HostProvider.get().extensionFsPath
			const scriptPath = path.join(extensionPath, "dist", "lmstudio-keepalive-proxy.js")
			return existsSync(scriptPath) ? scriptPath : null
		} catch (error) {
			console.error("LM Studio keep-alive proxy: failed to resolve script path:", error)
			return null
		}
	}

	private async launchProxyProcess(config: ProxyConfig): Promise<void> {
		const scriptPath = this.getProxyScriptPath()
		if (!scriptPath) {
			throw new Error("LM Studio keep-alive proxy script was not found. Reinstall the extension or rebuild the project.")
		}

		const env = {
			...process.env,
			LMSTUDIO_PROXY_PORT: String(config.proxyPort),
			LMSTUDIO_TARGET_PORT: String(config.targetPort),
			LMSTUDIO_TARGET_HOST: config.targetHost,
			LMSTUDIO_TARGET_PROTOCOL: config.targetProtocol,
			LMSTUDIO_HEARTBEAT_MS: String(config.heartbeatMs),
		}

		return new Promise((resolve, reject) => {
			let hasResolved = false
			let hasRejected = false

			const child = fork(scriptPath, {
				env,
				silent: true,
			})

			this.child = child

			const cleanup = () => {
				child.removeListener("message", onMessage)
				child.removeListener("exit", onExit)
				child.removeListener("error", onError)
				child.stdout?.removeListener("data", onStdout)
				child.stderr?.removeListener("data", onStderr)
			}

			const onStdout = (chunk: Buffer) => {
				const message = chunk.toString().trim()
				if (message) {
					console.info(`[LM Studio keep-alive] ${message}`)
				}
			}

			const onStderr = (chunk: Buffer) => {
				const message = chunk.toString().trim()
				if (message) {
					console.error(`[LM Studio keep-alive] ${message}`)
				}
			}

			const onMessage = async (message: ProxyProcessMessage) => {
				if (!message || typeof message !== "object") {
					return
				}

				if (message.type === "ready") {
					hasResolved = true
					this.currentConfig = config
					this.desiredConfig = null
					cleanup()
					resolve()
				} else if (message.type === "error") {
					hasRejected = true
					cleanup()
					if (message.code === "EADDRINUSE") {
						await this.showPortInUseError(config.proxyPort)
					}
					const friendlyMessage =
						message.code === "EADDRINUSE"
							? "Keep-alive proxy could not start (port in use). Disable the Cloudflare keep-alive setting or change LM Studio port."
							: message.message || "Keep-alive proxy failed to start."
					const error = new Error(friendlyMessage)
					;(error as any).code = message.code
					reject(error)
				}
			}

			const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
				this.child = null
				this.currentConfig = null
				this.desiredConfig = null
				this.activeProxyPort = null
				this.lastPortNotificationKey = null
				cleanup()

				if (hasResolved || hasRejected) {
					if (code !== 0 && code !== null) {
						console.warn(
							`LM Studio keep-alive proxy stopped (code: ${code ?? "unknown"}${
								signal ? `, signal: ${signal}` : ""
							})`,
						)
					}
					return
				}

				if (code !== 0 && code !== null) {
					console.error(
						`LM Studio keep-alive proxy exited unexpectedly (code: ${code}${signal ? `, signal: ${signal}` : ""})`,
					)
				}

				reject(
					new Error(
						`Keep-alive proxy exited before it was ready (code: ${code ?? "unknown"}${
							signal ? `, signal: ${signal}` : ""
						})`,
					),
				)
			}

			const onError = (error: Error) => {
				hasRejected = true
				this.child = null
				this.currentConfig = null
				this.desiredConfig = null
				this.activeProxyPort = null
				this.lastPortNotificationKey = null
				cleanup()
				reject(error)
			}

			child.stdout?.on("data", onStdout)
			child.stderr?.on("data", onStderr)
			child.on("message", onMessage)
			child.once("exit", onExit)
			child.once("error", onError)
		})
	}

	private async findAvailablePort(preferredPort: number): Promise<number> {
		if (await this.isPortAvailable(preferredPort)) {
			return preferredPort
		}

		try {
			const fallbackPort = await this.getEphemeralPort()
			console.info(
				`LM Studio keep-alive proxy: port ${preferredPort} is busy, selected available port ${fallbackPort} instead.`,
			)
			return fallbackPort
		} catch (error) {
			console.error("LM Studio keep-alive proxy: failed to locate an available port:", error)
			return preferredPort
		}
	}

	private async isPortAvailable(port: number): Promise<boolean> {
		return await new Promise<boolean>((resolve) => {
			const server = net.createServer()
			server.once("error", () => {
				server.close(() => resolve(false))
			})
			server.listen(
				{
					port,
					host: DEFAULT_TARGET_HOST,
					exclusive: true,
				},
				() => {
					server.close(() => resolve(true))
				},
			)
		})
	}

	private async getEphemeralPort(): Promise<number> {
		return await new Promise<number>((resolve, reject) => {
			const server = net.createServer()
			server.once("error", reject)
			server.listen(
				{
					port: 0,
					host: DEFAULT_TARGET_HOST,
					exclusive: true,
				},
				() => {
					const address = server.address() as AddressInfo | null
					if (!address || typeof address.port !== "number") {
						server.close(() => reject(new Error("Failed to determine ephemeral port")))
						return
					}
					server.close(() => resolve(address.port))
				},
			)
		})
	}

	private async notifyProxyPortChange(preferredPort: number, actualPort: number): Promise<void> {
		if (preferredPort === actualPort) {
			return
		}

		const notificationKey = `${preferredPort}->${actualPort}`
		if (this.lastPortNotificationKey === notificationKey) {
			return
		}
		this.lastPortNotificationKey = notificationKey

		const message = `LM Studio keep-alive proxy is using port ${actualPort} because port ${preferredPort} was busy. Update your Cloudflare tunnel or reverse proxy to target port ${actualPort}.`
		console.info(`[LM Studio keep-alive] ${message}`)

		if (!HostProvider.isInitialized()) {
			return
		}

		try {
			await HostProvider.window.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.INFORMATION,
					message,
					options: { modal: false },
				}),
			)
		} catch (error) {
			console.warn("LM Studio keep-alive proxy: failed to show dynamic port notification:", error)
		}
	}

	public getActiveProxyPort(): number | null {
		return this.activeProxyPort
	}

	private async showPortInUseError(port: number): Promise<void> {
		const message =
			"Keep-alive proxy could not start (port in use). Disable the Cloudflare keep-alive setting or change LM Studio port."
		console.error(`[LM Studio keep-alive] ${message}`)

		if (!HostProvider.isInitialized()) {
			return
		}

		try {
			await HostProvider.window.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.ERROR,
					message,
					options: {
						modal: false,
					},
				}),
			)
		} catch (error) {
			console.error("Failed to display keep-alive proxy error message to the user:", error)
		}
	}
}
