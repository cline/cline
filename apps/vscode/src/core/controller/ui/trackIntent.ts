import { Empty } from "@shared/proto/bedrock_coder/common"
import type { IntentEvent } from "@shared/proto/bedrock_coder/ui"
import type { Controller } from "../index"

export async function trackIntent(_controller: Controller, request: IntentEvent): Promise<Empty> {
	switch (request.action) {
		case "new_task_clicked":
			break
		case "prompt_submitted":
			break
	}

	return Empty.create({})
}
