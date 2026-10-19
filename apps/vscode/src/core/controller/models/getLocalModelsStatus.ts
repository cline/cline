import { StringRequest } from "@shared/proto/cline/common"
import { LocalModelsStatus, OllamaInstalledModel, OllamaRunningModel } from "@shared/proto/cline/models"
import { getLocalHardwareInfo } from "@/services/local-models/hardware"
import { createOllamaClient, getActiveOllamaPulls } from "@/services/local-models/ollama"
import { Controller } from ".."

export async function getLocalModelsStatus(_controller: Controller, request: StringRequest): Promise<LocalModelsStatus> {
	const hardware = await getLocalHardwareInfo()
	const client = createOllamaClient(request.value)
	try {
		const [{ version }, list, ps] = await Promise.all([client.version(), client.list(), client.ps()])
		return LocalModelsStatus.create({
			hardware,
			ollamaReachable: true,
			ollamaVersion: version,
			installed: list.models.map((model) =>
				OllamaInstalledModel.create({
					name: model.name,
					sizeBytes: model.size,
					parameterSize: model.details?.parameter_size ?? "",
					quantization: model.details?.quantization_level ?? "",
				}),
			),
			running: ps.models.map((model) =>
				OllamaRunningModel.create({
					name: model.name,
					sizeBytes: model.size,
					sizeVramBytes: model.size_vram,
					expiresAtMs: model.expires_at ? new Date(model.expires_at).getTime() : 0,
					// Reported by Ollama 0.7+, but not yet in the SDK's types.
					contextLength: (model as { context_length?: number }).context_length ?? 0,
				}),
			),
			activePulls: getActiveOllamaPulls(),
		})
	} catch {
		return LocalModelsStatus.create({ hardware, ollamaReachable: false, activePulls: getActiveOllamaPulls() })
	}
}
