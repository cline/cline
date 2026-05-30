import { type ApiHandler as SdkApiHandler, type ApiStreamChunk as SdkApiStreamChunk } from "@cline/llms"
import { ApiConfiguration, ModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"

// buildApiHandler now routes inference through the Cline SDK. It lives in
// apps/vscode/src/sdk/sdk-api-handler.ts and callers import it directly from
// there. It is deliberately NOT re-exported here: this barrel is imported
// widely for *types* only, and re-exporting a value from the SDK module would
// pull the entire SDK/session-factory runtime graph into every type importer
// at module-eval time (which can break extension activation). Keep this file
// types-only.

// Re-export the SDK inference contracts so callers can depend on the SDK types
// through the existing @core/api entry point. These are the canonical handler
// and stream types going forward; the local interfaces below remain for the
// classic provider classes until they are removed.
export type { SdkApiHandler, SdkApiStreamChunk }

export type CommonApiHandlerOptions = {
	onRetryAttempt?: ApiConfiguration["onRetryAttempt"]
}
export interface ApiHandler {
	createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ClineTool[], useResponseApi?: boolean): ApiStream
	getModel(): ApiHandlerModel
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
	abort?(): void
}

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
}

export interface ApiProviderInfo {
	providerId: string
	model: ApiHandlerModel
	mode: Mode
	customPrompt?: string // "compact"
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}
