import { window } from "vscode"
import { GetVisibleTabsRequest, GetVisibleTabsResponse } from "@/shared/proto/host/window"
import { createCachedTabQuery } from "./tabQueryCache"

const visibleTabsQuery = createCachedTabQuery(
	async () =>
		window.visibleTextEditors
			?.map((editor) => editor.document?.uri?.fsPath)
			.filter((path): path is string => Boolean(path)) ?? [],
	(paths) => GetVisibleTabsResponse.create({ paths }),
)

export async function getVisibleTabs(_: GetVisibleTabsRequest): Promise<GetVisibleTabsResponse> {
	return visibleTabsQuery.read()
}

export function resetVisibleTabsCacheForTests(): void {
	visibleTabsQuery.reset()
}

export function setVisibleTabsCacheTtlForTests(ttlMs: number): void {
	visibleTabsQuery.setTtlForTests(ttlMs)
}
