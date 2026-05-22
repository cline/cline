import type { EmptyRequest } from "@shared/proto/cline/common"
import { GeeStatusResponse } from "@shared/proto/cline/ui"
import * as vscode from "vscode"
import type { Controller } from "../index"

export async function geeDisconnect(_controller: Controller, _request: EmptyRequest): Promise<GeeStatusResponse> {
	try {
		await vscode.workspace.getConfiguration("aihydro").update("projectId", undefined, vscode.ConfigurationTarget.Global)
		return GeeStatusResponse.create({
			ok: true,
			authenticated: false,
			projectId: "",
			eeVersion: "",
			pythonExecutable: "",
			message: "Disconnected. Project credentials cleared.",
		})
	} catch (error) {
		return GeeStatusResponse.create({ ok: false, authenticated: false, message: String(error) })
	}
}
