import { ScrollDiffRequest, ScrollDiffResponse } from "@/shared/proto/index.host"

export async function scrollDiff(_request: ScrollDiffRequest): Promise<ScrollDiffResponse> {
	throw new Error("scrollDiff is not supported by the VS Code diff service.")
}
