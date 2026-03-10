import { HistoryItem } from "@shared/HistoryItem"
import { arePathsEqual } from "@/utils/path"

export function findMostRecentTaskForWorkspace(
	taskHistory: HistoryItem[] | undefined,
	workspacePath: string,
): HistoryItem | null {
	if (!taskHistory?.length) {
		return null
	}

	return (
		[...taskHistory]
			.filter((item) => {
				if (!item.ts || !item.task) {
					return false
				}

				return Boolean(
					(item.cwdOnTaskInitialization && arePathsEqual(item.cwdOnTaskInitialization, workspacePath)) ||
						(item.shadowGitConfigWorkTree && arePathsEqual(item.shadowGitConfigWorkTree, workspacePath)),
				)
			})
			.sort((a, b) => b.ts - a.ts)
			.at(0) ?? null
	)
}
