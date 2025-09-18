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

const serviceRegistry = {
	"cline.AccountService": AccountServiceClient,
	"cline.BrowserService": BrowserServiceClient,
	"cline.CheckpointsService": CheckpointsServiceClient,
	"cline.CommandsService": CommandsServiceClient,
	"cline.FileService": FileServiceClient,
	"cline.McpService": McpServiceClient,
	"cline.ModelsService": ModelsServiceClient,
	"cline.SlashService": SlashServiceClient,
	"cline.StateService": StateServiceClient,
	"cline.TaskService": TaskServiceClient,
	"cline.UiService": UiServiceClient,
	"cline.WebService": WebServiceClient,
} as const

export type ServiceClients = {
	-readonly [K in keyof typeof serviceRegistry]: InstanceType<(typeof serviceRegistry)[K]>
}

export class GrpcAdapter {
	private clients: Partial<ServiceClients> = {}

	constructor(address: string) {
		for (const [name, Client] of Object.entries(serviceRegistry)) {
			this.clients[name as keyof ServiceClients] = new (Client as any)(address, credentials.createInsecure())
		}
	}

	async call(service: keyof ServiceClients, method: string, request: any): Promise<any> {
		const client = this.clients[service]
		if (!client) {
			throw new Error(`No gRPC client registered for service: ${String(service)}`)
		}

		const fn = (client as any)[method]
		if (typeof fn !== "function") {
			throw new Error(`Method ${method} not found on service ${String(service)}`)
		}

		try {
			const fnAsync = promisify(fn).bind(client)
			const response = await fnAsync(request.message)
			return response?.toObject ? response.toObject() : response
		} catch (error) {
			console.error(`[GrpcAdapter] ${service}.${method} failed:`, error)
			throw error
		}
	}

	close(): void {
		for (const client of Object.values(this.clients)) {
			if (client && typeof (client as any).close === "function") {
				;(client as any).close()
			}
		}
	}
}
