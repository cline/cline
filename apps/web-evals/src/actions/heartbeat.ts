"use server"

import { redisClient } from "@/lib/server/redis"

export const getHeartbeat = async (runId: number) => {
	const redis = await redisClient()
	return redis.get(`heartbeat:${runId}`)
}
