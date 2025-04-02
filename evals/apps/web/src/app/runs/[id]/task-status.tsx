import { CircleCheck, CircleDashed, CircleSlash, LoaderCircle } from "lucide-react"

import { type Task } from "@evals/db"

type TaskStatusProps = {
	task: Task
}

export const TaskStatus = ({ task }: TaskStatusProps) => {
	return task.passed === false ? (
		<CircleSlash className="size-4 text-destructive" />
	) : task.passed === true ? (
		<CircleCheck className="size-4 text-green-500" />
	) : task.startedAt ? (
		<LoaderCircle className="size-4 animate-spin" />
	) : task.finishedAt ? (
		<LoaderCircle className="size-4 animate-spin" />
	) : (
		<CircleDashed className="size-4" />
	)
}
