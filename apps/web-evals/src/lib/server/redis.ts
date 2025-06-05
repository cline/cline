import { type RedisClientType, createClient } from "redis"

let redis: RedisClientType | null = null

export async function redisClient() {
	if (!redis) {
		redis = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" })
		redis.on("error", (error) => console.error("Redis error:", error))
		await redis.connect()
	}

	return redis
}
