import { useCallback, useEffect, useRef, useState } from "react"

export type EventSourceStatus = "waiting" | "connected" | "error"

export type EventSourceEvent = Event & { data: string }

type UseEventSourceOptions = {
	url: string
	withCredentials?: boolean
	onMessage: (event: MessageEvent) => void
}

export function useEventSource({ url, withCredentials, onMessage }: UseEventSourceOptions) {
	const sourceRef = useRef<EventSource | null>(null)
	const statusRef = useRef<EventSourceStatus>("waiting")
	const [status, setStatus] = useState<EventSourceStatus>("waiting")
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const isUnmountedRef = useRef(false)
	const handleMessage = useCallback((event: MessageEvent) => onMessage(event), [onMessage])

	const cleanup = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current)
			reconnectTimeoutRef.current = null
		}

		if (sourceRef.current) {
			sourceRef.current.close()
			sourceRef.current = null
		}
	}, [])

	const createEventSource = useCallback(() => {
		if (isUnmountedRef.current) {
			return
		}

		cleanup()

		statusRef.current = "waiting"
		setStatus("waiting")

		sourceRef.current = new EventSource(url, { withCredentials })

		sourceRef.current.onopen = () => {
			if (isUnmountedRef.current) {
				return
			}

			statusRef.current = "connected"
			setStatus("connected")
		}

		sourceRef.current.onmessage = (event) => {
			if (isUnmountedRef.current) {
				return
			}

			handleMessage(event)
		}

		sourceRef.current.onerror = () => {
			if (isUnmountedRef.current) {
				return
			}

			statusRef.current = "error"
			setStatus("error")

			// Clean up current connection.
			cleanup()

			// Attempt to reconnect after a delay.
			reconnectTimeoutRef.current = setTimeout(() => {
				if (!isUnmountedRef.current) {
					createEventSource()
				}
			}, 1000)
		}
	}, [url, withCredentials, handleMessage, cleanup])

	useEffect(() => {
		isUnmountedRef.current = false
		createEventSource()

		// Initial connection timeout.
		const initialTimeout = setTimeout(() => {
			if (statusRef.current === "waiting" && !isUnmountedRef.current) {
				createEventSource()
			}
		}, 5000)

		return () => {
			isUnmountedRef.current = true
			clearTimeout(initialTimeout)
			cleanup()
		}
	}, [createEventSource, cleanup])

	return status
}
