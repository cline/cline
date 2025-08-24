import type { ModelFamily } from "@/shared/prompts"
import type { ClineDefaultTool } from "@/shared/tools"
import type { SystemPromptContext } from "./types"

export interface ClineToolSpec {
	variant: ModelFamily
	id: ClineDefaultTool
	name: string
	description: string
	instruction?: string
	contextRequirements?: (context: SystemPromptContext) => boolean
	parameters?: Array<ClineToolSpecParameter>
}

interface ClineToolSpecParameter {
	name: string
	required: boolean
	instruction: string
	usage?: string
	dependencies?: ClineDefaultTool[]
	description?: string
}
