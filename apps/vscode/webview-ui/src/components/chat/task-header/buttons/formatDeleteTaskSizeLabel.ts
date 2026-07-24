import { formatSize } from "@/utils/format"

export function formatDeleteTaskSizeLabel(taskSize?: number) {
	return taskSize === undefined ? "--" : formatSize(taskSize)
}
