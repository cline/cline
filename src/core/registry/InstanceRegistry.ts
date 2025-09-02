import { constants as fsConstants } from "fs"
import type { FileHandle } from "fs/promises"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

type InstanceJson = {
	address: string
	core_port: number
	host_port: number
	status: "starting" | "healthy" | "unhealthy"
	last_seen: string
	process_pid: number
	version?: string
	created_at: string
	metadata?: Record<string, any>
}

export class InstanceRegistry {
	private registryDir: string
	private instanceFile: string
	private fullAddress: string
	private hostPort: string
	private handle: FileHandle | null = null

	constructor(clineDir: string, fullAddress: string) {
		this.registryDir = path.join(clineDir, "registry")

		// fullAddress is expected as host:port (no scheme)
		this.fullAddress = fullAddress
		this.hostPort = this.fullAddress
		const encodedAddress = encodeURIComponent(this.hostPort)
		this.instanceFile = path.join(this.registryDir, `${encodedAddress}.json`)
	}

	static buildFullAddress(opts: { protocol?: "grpc" | "grpcs" | string; host: string; port: number }) {
		const protocol = opts.protocol || "grpc"
		return `${protocol}://${opts.host}:${opts.port}`
	}

	async register(initial: { corePort: number; hostPort: number; version?: string; status?: InstanceJson["status"] }) {
		// Ensure directory exists
		await fs.mkdir(this.registryDir, { recursive: true })

		// Open or create the instance file and keep a process-held handle (Node-native; single-writer semantics, no OS locks)
		await this.acquireKernelLock()

		// Write instance file content while holding the lock
		const now = new Date().toISOString()
		const data: InstanceJson = {
			address: this.hostPort,
			core_port: initial.corePort,
			host_port: initial.hostPort,
			status: initial.status || "starting",
			last_seen: now,
			process_pid: process.pid,
			version: initial.version,
			created_at: now,
			metadata: {
				cline_dir: process.env.CLINE_DIR || path.join(os.homedir(), ".cline"),
				node_version: process.version,
				platform: process.platform,
			},
		}

		await this.writeLocked(JSON.stringify(data, null, 2))

		// Optionally set default.json if not present

		await this.setAsDefaultIfNeeded()
	}

	async updateStatus(status: InstanceJson["status"]) {
		try {
			const buf = await fs.readFile(this.instanceFile, "utf8")
			const json = JSON.parse(buf) as InstanceJson
			json.status = status
			json.last_seen = new Date().toISOString()
			await this.writeLocked(JSON.stringify(json, null, 2))
		} catch {
			// ignore
		}
	}

	async touch() {
		try {
			const buf = await fs.readFile(this.instanceFile, "utf8")
			const json = JSON.parse(buf) as InstanceJson
			json.last_seen = new Date().toISOString()
			await this.writeLocked(JSON.stringify(json, null, 2))
		} catch {
			// ignore
		}
	}

	async unregister() {
		try {
			// Close the file handle first, then remove the instance file
			await this.releaseKernelLock()
			await fs.rm(this.instanceFile, { force: true })
		} catch {
			// ignore
		}
	}

	private async setAsDefaultIfNeeded() {
		const defaultFile = path.join(this.registryDir, "default.json")
		try {
			await fs.access(defaultFile, fsConstants.F_OK)
			// exists - do nothing
		} catch {
			const payload = {
				default_instance: this.hostPort,
				last_updated: new Date().toISOString(),
			}
			try {
				await fs.writeFile(defaultFile, JSON.stringify(payload, null, 2), "utf8")
			} catch {
				console.error("Failed to write default.json")
			}
		}
	}

	private async acquireKernelLock() {
		// Open or create the instance file and keep the handle (Node-native, no platform-specific locking)
		this.handle = await fs.open(this.instanceFile, "a+")
	}

	private async releaseKernelLock() {
		try {
			if (this.handle) {
				await this.handle.close()
				this.handle = null
			}
		} catch {
			console.error("Failed to release kernel lock")
		}
	}

	private async writeLocked(content: string) {
		// If we have the handle (preferred path), write via the open handle
		if (this.handle) {
			await this.handle.truncate(0)
			await this.handle.writeFile(content, "utf8")
			// Optional durability: fsync not exposed on FileHandle; acceptable for our use case
			return
		}
		// Fallback: write by path
		await fs.writeFile(this.instanceFile, content, "utf8")
	}
}
