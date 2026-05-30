import { ArtifactCellOutput } from "@shared/proto/cline/html_preview"
import type { RunArtifactCodeResult } from "./ArtifactKernelService"

export function mapRunResultToOutputs(result: RunArtifactCodeResult): ArtifactCellOutput[] {
	const outputs: ArtifactCellOutput[] = []
	if (result.stdout) {
		outputs.push(ArtifactCellOutput.create({ type: "stdout", text: result.stdout }))
	}
	if (result.stderr) {
		outputs.push(ArtifactCellOutput.create({ type: "stderr", text: result.stderr }))
	}
	if (result.error) {
		outputs.push(ArtifactCellOutput.create({ type: "error", text: result.error }))
	}
	for (const b64 of result.imagesPngBase64) {
		outputs.push(ArtifactCellOutput.create({ type: "image/png", data: b64 }))
	}
	for (const b64 of result.videosMp4Base64 ?? []) {
		outputs.push(ArtifactCellOutput.create({ type: "video/mp4", data: b64 }))
	}
	return outputs
}
