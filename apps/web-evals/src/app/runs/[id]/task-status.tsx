import { CircleCheck, CircleDashed, CircleSlash, LoaderCircle } from "lucide-react"

import type { Task } from "@roo-code/evals"

type TaskStatusProps = {
	task: Task
	running: boolean
}

export const TaskStatus = ({ task, running }: TaskStatusProps) => {
	return task.passed === false ? (
		<CircleSlash className="size-4 text-destructive" />
	) : task.passed === true ? (
		<CircleCheck className="size-4 text-green-500" />
	) : running ? (
		<LoaderCircle className="size-4 animate-spin" />
	) : (
		<CircleDashed className="size-4" />
	)
}
