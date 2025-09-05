import { promisify } from "util"
import { AccountServiceClient } from "../../src/generated/grpc-js/cline/account"
import { TaskServiceClient } from "../../src/generated/grpc-js/cline/task"

export class GrpcAdapter {
	private clients: Record<string, any> = {}

	constructor(address: string) {
		// WIP: to review the import credentials from the main project's grpc package to avoid version mismatch
		const { credentials } = require("../../node_modules/@grpc/grpc-js")

		this.clients["cline.AccountService"] = new AccountServiceClient(address, credentials.createInsecure())
		this.clients["cline.TaskService"] = new TaskServiceClient(address, credentials.createInsecure())
	}

	async call(service: string, method: string, request: any): Promise<any> {
		try {
			const client = this.clients[service]
			if (!client) {
				throw new Error(`No gRPC client registered for service: ${service}`)
			}

			// Dynamic method invocation
			const fn = (client as any)[method].bind(client)
			if (!fn) {
				throw new Error(`Method ${method} not found on service ${service}`)
			}

			const fnAsync = promisify(fn)
			const response = await fnAsync(request.message)
			return response.toObject ? response.toObject() : response
		} catch (error) {
			console.error("[Error] Grpc request failed with:", error)
			throw error
		}
	}

	/**
	 * Close all client connections
	 */
	close(): void {
		for (const client of Object.values(this.clients)) {
			if (client && typeof client.close === "function") {
				client.close()
			}
		}
	}
}
