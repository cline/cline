import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./providers/anthropic"
import { AwsBedrockHandler } from "./providers/bedrock"
import { OpenRouterHandler } from "./providers/openrouter"
import { VertexHandler } from "./providers/vertex"
import { OpenAiHandler } from "./providers/openai"
import { OllamaHandler } from "./providers/ollama"
import { LmStudioHandler } from "./providers/lmstudio"
import { GeminiHandler } from "./providers/gemini"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { ApiStream } from "./transform/stream"
import { DeepSeekHandler } from "./providers/deepseek"
import { DashboardHandler } from "./providers/dashboard"
import { CoffeePlotHandler } from "./providers/coffeePlot"
import { FinanceHandler } from "./providers/finance"
import { InventoryHandler } from "./providers/inventory"
import { QualityControlHandler } from "./providers/qualityControl"
import { TraceabilityHandler } from "./providers/traceability"
import { MachineryHandler } from "./providers/machinery"
import { ReportHandler } from "./providers/report"

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	getModel(): { id: string; info: ModelInfo }
	renderView?(): void
	fetchData?(): void
	analyzeSoil?(): void
	registerActivity?(): void
	createTransaction?(): void
	generateCashFlow?(): void
	addToInventory?(): void
	removeFromInventory?(): void
	assessQuality?(): void
	finalizeReport?(): void
	traceLot?(): void
	generateAudit?(): void
	scheduleMaintenance?(): void
	updateStatus?(): void
	generateReport?(): void
	exportToFormat?(): void
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration
	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler(options)
		case "openrouter":
			return new OpenRouterHandler(options)
		case "bedrock":
			return new AwsBedrockHandler(options)
		case "vertex":
			return new VertexHandler(options)
		case "openai":
			return new OpenAiHandler(options)
		case "ollama":
			return new OllamaHandler(options)
		case "lmstudio":
			return new LmStudioHandler(options)
		case "gemini":
			return new GeminiHandler(options)
		case "openai-native":
			return new OpenAiNativeHandler(options)
		case "deepseek":
			return new DeepSeekHandler(options)
		case "dashboard":
			return new DashboardHandler(options)
		case "coffeePlot":
			return new CoffeePlotHandler(options)
		case "finance":
			return new FinanceHandler(options)
		case "inventory":
			return new InventoryHandler(options)
		case "qualityControl":
			return new QualityControlHandler(options)
		case "traceability":
			return new TraceabilityHandler(options)
		case "machinery":
			return new MachineryHandler(options)
		case "report":
			return new ReportHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}
