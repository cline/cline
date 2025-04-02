import { useState, useCallback, useRef } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"

import { RooCodeEventName, taskEventSchema } from "@evals/types"
import { Run } from "@evals/db"

import { getTasks } from "@/lib/server/tasks"
import { useEventSource } from "@/hooks/use-event-source"

export const useRunStatus = (run: Run) => {
	const [tasksUpdatedAt, setTasksUpdatedAt] = useState<number>()
	const outputRef = useRef<Map<number, string[]>>(new Map())
	const [outputCounts, setOutputCounts] = useState<Record<number, number>>({})

	const { data: tasks } = useQuery({
		queryKey: ["run", run.id, tasksUpdatedAt],
		queryFn: async () => getTasks(run.id),
		placeholderData: keepPreviousData,
		refetchInterval: 10_000,
	})

	const url = `/api/runs/${run.id}/stream`

	const onMessage = useCallback((messageEvent: MessageEvent) => {
		let data

		try {
			data = JSON.parse(messageEvent.data)
		} catch (_) {
			console.log(`invalid JSON: ${messageEvent.data}`)
			return
		}

		const result = taskEventSchema.safeParse(data)

		if (!result.success) {
			console.log(`unrecognized messageEvent.data: ${messageEvent.data}`)
			return
		}

		const { eventName, payload, taskId } = result.data

		if (!taskId) {
			console.log(`no taskId: ${messageEvent.data}`)
			return
		}

		switch (eventName) {
			case RooCodeEventName.TaskStarted:
			case RooCodeEventName.TaskCompleted:
			case RooCodeEventName.TaskAborted:
				setTasksUpdatedAt(Date.now())
				break
			case RooCodeEventName.Message: {
				const [
					{
						message: { text },
					},
				] = payload

				if (text) {
					outputRef.current.set(taskId, [...(outputRef.current.get(taskId) || []), text])
					const outputCounts: Record<number, number> = {}

					for (const [taskId, messages] of outputRef.current.entries()) {
						outputCounts[taskId] = messages.length
					}

					setOutputCounts(outputCounts)
				}

				break
			}
		}
	}, [])

	const status = useEventSource({ url, onMessage })

	return { tasks, status, output: outputRef.current, outputCounts }
}
