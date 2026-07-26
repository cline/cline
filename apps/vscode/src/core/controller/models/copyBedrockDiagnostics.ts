import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import { writeTextToClipboard } from "@/utils/env"
import type { Controller } from "../index"

export async function copyBedrockDiagnostics(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await writeTextToClipboard(controller.bedrockStartup.diagnosticsText())
	return Empty.create()
}
