import { LangfuseClient } from "@langfuse/client"
import { LangfuseSpanProcessor } from "@langfuse/otel"
import { NodeSDK } from "@opentelemetry/sdk-node"

// TODO: Convert this into a singleton pattern that can be configured with different providers apart from Langfuse

new LangfuseClient({
	publicKey: process.env.LANGFUSE_PUBLIC_KEY,
	secretKey: process.env.LANGFUSE_SECRET_KEY,
	baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
})

export const langfuse = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] })
