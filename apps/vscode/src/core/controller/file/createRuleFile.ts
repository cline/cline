import { RuleFile, RuleFileRequest } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function createRuleFile(_controller: Controller, _request: RuleFileRequest): Promise<RuleFile> {
	return RuleFile.create({})
}
