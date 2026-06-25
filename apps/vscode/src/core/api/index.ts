import { ModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"

// buildApiHandler now routes inference through the Cline SDK. It lives in
// apps/vscode/src/sdk/sdk-api-handler.ts and callers import it directly from
// there. It is deliberately NOT re-exported here: this barrel is imported
// widely for *types* only, and re-exporting a value from the SDK module would
// pull the entire SDK/session-factory runtime graph into every type importer
// at module-eval time (which can break extension activation). Keep this file
// types-only.

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
	providerId?: string
}

export interface ApiProviderInfo {
	providerId: string
	model: ApiHandlerModel
	mode: Mode
	customPrompt?: string // "compact"
}
