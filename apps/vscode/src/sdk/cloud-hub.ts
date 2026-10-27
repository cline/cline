import { fileURLToPath } from "node:url"
import { ensureCompatibleLocalHubUrl, NodeHubClient, setHubDaemonLauncher } from "@cline/core"
import { HubCloudSessionClient } from "@cline/core/cloud"

export class VscodeCloudHub {
	readonly cloud = new HubCloudSessionClient(() => this.connect())
	private connection?: Promise<NodeHubClient>
	private disposed = false

	constructor(private readonly cwd: string) {}

	private connect(): Promise<NodeHubClient> {
		if (this.disposed) return Promise.reject(new Error("Cloud viewer is closed."))
		if (this.connection) return this.connection
		const connecting = this.open()
		this.connection = connecting
		void connecting.catch(() => {
			if (this.connection === connecting) this.connection = undefined
		})
		return connecting
	}

	private async open(): Promise<NodeHubClient> {
		setHubDaemonLauncher({
			command: process.execPath,
			args: [fileURLToPath(new URL("./cloud-hub-daemon.js", import.meta.url))],
			env: { ELECTRON_RUN_AS_NODE: "1" },
		})
		const url = await ensureCompatibleLocalHubUrl({ strategy: "require-hub", cwd: this.cwd, workspaceRoot: this.cwd })
		if (!url) throw new Error("Unable to start or connect to the Cline Hub. Please reload the extension and try again.")
		const client = new NodeHubClient({
			url,
			clientType: "vscode-cloud-handoff",
			displayName: "Cline for VS Code",
			cwd: this.cwd,
			workspaceRoot: this.cwd,
		})
		try {
			await client.connect()
			if (this.disposed) throw new Error("Cloud viewer is closed.")
			return client
		} catch (error) {
			await client.dispose()
			throw error
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true
		await this.cloud.dispose()
		const client = await this.connection?.catch(() => undefined)
		await client?.dispose()
	}
}
