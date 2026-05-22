import type { StringRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"
import { sendAddToInputEvent } from "./subscribeToAddToInput"
import { sendChatButtonClickedEvent } from "./subscribeToChatButtonClicked"

export async function sendToChat(_controller: Controller, request: StringRequest): Promise<Empty> {
	await sendChatButtonClickedEvent()
	if (request.value) {
		await sendAddToInputEvent(request.value)
	}
	return Empty.create({})
}
