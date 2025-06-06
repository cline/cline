import { createClient, type RedisClientType } from "redis"

import { EVALS_TIMEOUT } from "@roo-code/types"

let redis: RedisClientType | undefined

export const redisClient = async () => {
	if (!redis) {
		redis = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" })
		redis.on("error", (error) => console.error("redis error:", error))
		await redis.connect()
	}

	return redis
}

export const getPubSubKey = (runId: number) => `evals:${runId}`
export const getRunnersKey = (runId: number) => `runners:${runId}`
export const getHeartbeatKey = (runId: number) => `heartbeat:${runId}`

export const registerRunner = async ({ runId, taskId }: { runId: number; taskId: number }) => {
	const redis = await redisClient()
	const runnersKey = getRunnersKey(runId)
	await redis.sAdd(runnersKey, `task-${taskId}:${process.env.HOSTNAME ?? process.pid}`)
	await redis.expire(runnersKey, EVALS_TIMEOUT / 1_000)
}

export const deregisterRunner = async ({ runId, taskId }: { runId: number; taskId: number }) => {
	const redis = await redisClient()
	await redis.sRem(getRunnersKey(runId), `task-${taskId}:${process.env.HOSTNAME ?? process.pid}`)
}

export const startHeartbeat = async (runId: number, seconds: number = 10) => {
	const pid = process.pid.toString()
	const redis = await redisClient()
	const heartbeatKey = getHeartbeatKey(runId)
	await redis.setEx(heartbeatKey, seconds, pid)

	return setInterval(
		() =>
			redis.expire(heartbeatKey, seconds).catch((error) => {
				console.error("heartbeat error:", error)
			}),
		(seconds * 1_000) / 2,
	)
}

export const stopHeartbeat = async (runId: number, heartbeat: NodeJS.Timeout) => {
	clearInterval(heartbeat)

	try {
		const redis = await redisClient()
		await redis.del(getHeartbeatKey(runId))
	} catch (error) {
		console.error("redis.del failed:", error)
	}
}
