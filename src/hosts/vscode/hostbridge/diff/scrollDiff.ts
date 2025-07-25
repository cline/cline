import { ScrollDiffRequest, ScrollDiffResponse } from "@/shared/proto/index.host"

export async function scrollDiff(_request: ScrollDiffRequest): Promise<ScrollDiffResponse> {
	throw new Error("diffService is not supported. Use the VscodeDiffViewProvider.")
}
