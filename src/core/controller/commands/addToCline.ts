import { Controller } from "../index"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { getFileMentionFromPath } from "@/core/mentions"
import { singleFileDiagnosticsToProblemsString } from "@/integrations/diagnostics"
import { WebviewProvider } from "@/core/webview"
import { sendAddToInputEventToClient } from "../ui/subscribeToAddToInput"

// 'Add to Cline' context menu in editor and code action
// Inserts the selected code into the chat.
export async function addToCline(controller: Controller, request: CommandContext): Promise<Empty> {
	if (!request.selectedText) {
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)

	let input = `${fileMention}\n\`\`\`\n${request.selectedText}\n\`\`\``
	if (request.diagnostics.length) {
		const problemsString = await singleFileDiagnosticsToProblemsString(filePath, request.diagnostics)
		input += `\nProblems:\n${problemsString}`
	}

	const lastActiveWebview = WebviewProvider.getLastActiveInstance()
	if (lastActiveWebview) {
		await sendAddToInputEventToClient(lastActiveWebview.getClientId(), input)
	}

	console.log("addToCline", request.selectedText, filePath, request.language)
	telemetryService.captureButtonClick("codeAction_addToChat", controller.task?.ulid)

	return {}
}
