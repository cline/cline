import { RuleFileRequest } from "@shared/proto/cline/file"

// Helper for creating delete requests
export const DeleteRuleFileRequest = {
	create: (params: { rulePath: string; isGlobal: boolean; metadata?: any; type?: string }): RuleFileRequest => {
		return RuleFileRequest.create({
			rulePath: params.rulePath,
			isGlobal: params.isGlobal,
			metadata: params.metadata,
			type: params.type,
		})
	},
}

// Helper for creating create requests
export const CreateRuleFileRequest = {
	create: (params: { filename: string; isGlobal: boolean; metadata?: any; type?: string }): RuleFileRequest => {
		return RuleFileRequest.create({
			filename: params.filename,
			isGlobal: params.isGlobal,
			metadata: params.metadata,
			type: params.type,
		})
	},
}
