import { EndProgressRequest } from "@/shared/proto/index.host"
import { progressMap } from "./startProgress"

export async function endProgress(request: EndProgressRequest): Promise<void> {
	const { progressId } = request
	const resolve = progressMap.get(progressId)

	if (resolve) {
		resolve() // This completes the withProgress callback
		progressMap.delete(progressId)
	}
}
