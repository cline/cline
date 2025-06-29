import { EmptyRequest, String } from "@/shared/proto/common"
import { URI } from "vscode-uri"

/**
 * VSCode implementation of getting the URI scheme using vscode-uri package
 * @param request Empty request
 * @returns Promise resolving to the URI scheme string
 */
export async function getUriScheme(_: EmptyRequest): Promise<String> {
	const sampleUri = URI.parse("vscode://extension")
	const scheme = sampleUri.scheme
	return String.create({ value: scheme })
}
