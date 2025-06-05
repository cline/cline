"use server"

import { redisClient } from "./redis"

export const getRunners = async (runId: number) => {
	const redis = await redisClient()
	return redis.sMembers(`runners:${runId}`)
}
