import { showSaveDialog as hostShowSaveDialog } from "@/hosts/vscode/window/showSaveDialog"
import { ShowSaveDialogRequest, ShowSaveDialogResponse } from "@/shared/proto/host/window"

export async function showSaveDialog(
	filters?: Record<string, string[]>,
	defaultPath?: string,
	saveLabel?: string,
): Promise<string> {
	const request = ShowSaveDialogRequest.create({
		filters: filters
			? {
					filterMap: Object.fromEntries(Object.entries(filters).map(([key, extensions]) => [key, { extensions }])),
				}
			: undefined,
		defaultUri: defaultPath,
		saveLabel,
	})

	const response = await hostShowSaveDialog(request)
	return response.path || ""
}
