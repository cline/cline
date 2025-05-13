import { RuleFileRequest } from "../../proto/file"

// Helper for creating delete requests
export const DeleteRuleFileRequest = {
	create: (params: { rulePath: string; isGlobal: boolean; metadata?: any }): RuleFileRequest => {
		return RuleFileRequest.create({
			rulePath: params.rulePath,
			isGlobal: params.isGlobal,
			metadata: params.metadata,
		})
	},
}

// Helper for creating create requests
export const CreateRuleFileRequest = {
	create: (params: { filename: string; isGlobal: boolean; metadata?: any }): RuleFileRequest => {
		return RuleFileRequest.create({
			filename: params.filename,
			isGlobal: params.isGlobal,
			metadata: params.metadata,
		})
	},
}
