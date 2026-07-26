import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { Empty, type EmptyRequest } from "@shared/proto/bedrock_coder/common"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

export async function openBedrockDiagnosticLog(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const logPath = controller.bedrockStartup.diagnosticLogPath
	await mkdir(dirname(logPath), { recursive: true })
	await appendFile(logPath, "", "utf8")
	await HostProvider.window.showTextDocument({
		path: logPath,
		options: { preview: false },
	})
	return Empty.create()
}
