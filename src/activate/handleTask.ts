import * as vscode from "vscode"

import { ClineProvider } from "../core/webview/ClineProvider"

import { t } from "../i18n"

import { COMMAND_IDS } from "./CodeActionProvider"

export const handleNewTask = async (params: { prompt?: string } | null | undefined) => {
	let prompt = params?.prompt

	if (!prompt) {
		prompt = await vscode.window.showInputBox({
			prompt: t("common:input.task_prompt"),
			placeHolder: t("common:input.task_placeholder"),
		})
	}

	if (!prompt) {
		await vscode.commands.executeCommand("roo-cline.SidebarProvider.focus")
		return
	}

	await ClineProvider.handleCodeAction(COMMAND_IDS.NEW_TASK, "NEW_TASK", { userInput: prompt })
}
