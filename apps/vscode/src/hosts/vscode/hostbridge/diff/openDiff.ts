import { OpenDiffRequest, OpenDiffResponse } from "@/shared/proto/index.host"

export async function openDiff(_request: OpenDiffRequest): Promise<OpenDiffResponse> {
	throw new Error("openDiff is not supported by the VS Code diff service.")
}
