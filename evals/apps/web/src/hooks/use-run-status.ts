import { useState, useCallback, useRef } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"

import { TokenUsage, taskEventSchema, RooCodeEventName, EvalEventName } from "@evals/types"
import { Run } from "@evals/db"

import { getTasks } from "@/lib/server/tasks"
import { useEventSource } from "@/hooks/use-event-source"

export const useRunStatus = (run: Run) => {
	const [tasksUpdatedAt, setTasksUpdatedAt] = useState<number>()
	const [usageUpdatedAt, setUsageUpdatedAt] = useState<number>()

	const tokenUsage = useRef<Map<number, TokenUsage & { duration?: number }>>(new Map())
	const startTimes = useRef<Map<number, number>>(new Map())

	const { data: tasks } = useQuery({
		queryKey: ["run", run.id, tasksUpdatedAt],
		queryFn: async () => getTasks(run.id),
		placeholderData: keepPreviousData,
		refetchInterval: 30_000,
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
				startTimes.current.set(taskId, Date.now())
				break
			case RooCodeEventName.TaskTokenUsageUpdated: {
				const startTime = startTimes.current.get(taskId)
				const duration = startTime ? Date.now() - startTime : undefined
				tokenUsage.current.set(taskId, { ...payload[1], duration })
				setUsageUpdatedAt(Date.now())
				break
			}
			case EvalEventName.Pass:
			case EvalEventName.Fail:
				setTasksUpdatedAt(Date.now())
				break
		}
	}, [])

	const status = useEventSource({ url, onMessage })

	return {
		status,
		tasks,
		tokenUsage: tokenUsage.current,
		usageUpdatedAt,
	}
}
