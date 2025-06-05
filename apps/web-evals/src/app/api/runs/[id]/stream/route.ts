import type { NextRequest } from "next/server"

import { taskEventSchema } from "@roo-code/types"
import { findRun } from "@roo-code/evals"

import { SSEStream } from "@/lib/server/sse-stream"
import { redisClient } from "@/lib/server/redis"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const requestId = crypto.randomUUID()
	const stream = new SSEStream()
	const run = await findRun(Number(id))
	const redis = await redisClient()

	let isStreamClosed = false
	const channelName = `evals:${run.id}`

	const onMessage = async (data: string) => {
		if (isStreamClosed || stream.isClosed) {
			return
		}

		try {
			const taskEvent = taskEventSchema.parse(JSON.parse(data))
			// console.log(`[stream#${requestId}] task event -> ${taskEvent.eventName}`)
			const writeSuccess = await stream.write(JSON.stringify(taskEvent))

			if (!writeSuccess) {
				await disconnect()
			}
		} catch (_error) {
			console.error(`[stream#${requestId}] invalid task event:`, data)
		}
	}

	const disconnect = async () => {
		if (isStreamClosed) {
			return
		}

		isStreamClosed = true

		try {
			await redis.unsubscribe(channelName)
			console.log(`[stream#${requestId}] unsubscribed from ${channelName}`)
		} catch (error) {
			console.error(`[stream#${requestId}] error unsubscribing:`, error)
		}

		try {
			await stream.close()
		} catch (error) {
			console.error(`[stream#${requestId}] error closing stream:`, error)
		}
	}

	await redis.subscribe(channelName, onMessage)

	request.signal.addEventListener("abort", () => {
		console.log(`[stream#${requestId}] abort`)

		disconnect().catch((error) => {
			console.error(`[stream#${requestId}] cleanup error:`, error)
		})
	})

	return stream.getResponse()
}
