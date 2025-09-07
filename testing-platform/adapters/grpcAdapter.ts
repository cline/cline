import { AccountServiceClient } from "@cline-grpc/account"
import { BrowserServiceClient } from "@cline-grpc/browser"
import { CheckpointsServiceClient } from "@cline-grpc/checkpoints"
import { CommandsServiceClient } from "@cline-grpc/commands"
import { FileServiceClient } from "@cline-grpc/file"
import { McpServiceClient } from "@cline-grpc/mcp"
import { ModelsServiceClient } from "@cline-grpc/models"
import { SlashServiceClient } from "@cline-grpc/slash"
import { StateServiceClient } from "@cline-grpc/state"
import { TaskServiceClient } from "@cline-grpc/task"
import { UiServiceClient } from "@cline-grpc/ui"
import { WebServiceClient } from "@cline-grpc/web"
import { credentials } from "@grpc/grpc-js"
import { promisify } from "util"

export class GrpcAdapter {
	private clients: Record<string, any> = {}

	constructor(address: string) {
		this.clients["cline.AccountService"] = new AccountServiceClient(address, credentials.createInsecure())
		this.clients["cline.BrowserService"] = new BrowserServiceClient(address, credentials.createInsecure())
		this.clients["cline.CheckpointsService"] = new CheckpointsServiceClient(address, credentials.createInsecure())
		this.clients["cline.CommandsService"] = new CommandsServiceClient(address, credentials.createInsecure())
		this.clients["cline.FileService"] = new FileServiceClient(address, credentials.createInsecure())
		this.clients["cline.McpService"] = new McpServiceClient(address, credentials.createInsecure())
		this.clients["cline.ModelsService"] = new ModelsServiceClient(address, credentials.createInsecure())
		this.clients["cline.SlashService"] = new SlashServiceClient(address, credentials.createInsecure())
		this.clients["cline.StateService"] = new StateServiceClient(address, credentials.createInsecure())
		this.clients["cline.TaskService"] = new TaskServiceClient(address, credentials.createInsecure())
		this.clients["cline.UiService"] = new UiServiceClient(address, credentials.createInsecure())
		this.clients["cline.WebService"] = new WebServiceClient(address, credentials.createInsecure())
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
