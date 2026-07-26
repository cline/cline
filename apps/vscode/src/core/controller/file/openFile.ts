import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function openFile(_controller: Controller, request: StringRequest): Promise<Empty> {
	if (request.value) {
		await openFileIntegration(request.value)
	}
	return Empty.create()
}
