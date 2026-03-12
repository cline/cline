import { TabInputText, window } from "vscode"
import { GetOpenTabsRequest, GetOpenTabsResponse } from "@/shared/proto/host/window"
import { createCachedTabQuery } from "./tabQueryCache"

const openTabsQuery = createCachedTabQuery(
	async () =>
		window.tabGroups.all
			.flatMap((group) => group.tabs)
			.map((tab) => (tab.input as TabInputText)?.uri?.fsPath)
			.filter((path): path is string => Boolean(path)),
	(paths) => GetOpenTabsResponse.create({ paths }),
)

export async function getOpenTabs(_: GetOpenTabsRequest): Promise<GetOpenTabsResponse> {
	return openTabsQuery.read()
}

export function resetOpenTabsCacheForTests(): void {
	openTabsQuery.reset()
}

export function setOpenTabsCacheTtlForTests(ttlMs: number): void {
	openTabsQuery.setTtlForTests(ttlMs)
}
