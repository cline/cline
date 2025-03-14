export type QueueItem = {
	task: string
	images?: string[]
	order: number
	isCompleted: boolean
}

export type Queue = {
	items: QueueItem[]
}
