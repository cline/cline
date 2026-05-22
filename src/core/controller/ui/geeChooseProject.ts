import type { EmptyRequest } from "@shared/proto/cline/common"
import { GeeStatusResponse } from "@shared/proto/cline/ui"
import * as vscode from "vscode"
import type { Controller } from "../index"

export async function geeChooseProject(_controller: Controller, _request: EmptyRequest): Promise<GeeStatusResponse> {
	try {
		const chooseResult = (await vscode.commands.executeCommand("aihydro.gee.chooseProject")) as
			| { ok?: boolean; project_id?: string }
			| undefined
		if (!chooseResult?.ok || !chooseResult.project_id) {
			return GeeStatusResponse.create({
				ok: false,
				authenticated: false,
				message: "No project selected",
			})
		}
		const connectResult = (await vscode.commands.executeCommand("aihydro.gee.connect")) as
			| {
					ok?: boolean
					authenticated?: boolean
					project_id?: string
					message?: string
					runtime?: { ee_version?: string; python_executable?: string }
			  }
			| undefined
		if (!connectResult) {
			return GeeStatusResponse.create({
				ok: false,
				authenticated: false,
				projectId: chooseResult.project_id,
				message: "Project saved but GEE connection check failed",
			})
		}
		return GeeStatusResponse.create({
			ok: connectResult.ok ?? false,
			authenticated: connectResult.authenticated ?? false,
			projectId: connectResult.project_id ?? chooseResult.project_id,
			eeVersion: connectResult.runtime?.ee_version ?? "",
			pythonExecutable: connectResult.runtime?.python_executable ?? "",
			message: connectResult.message ?? "",
		})
	} catch (error) {
		return GeeStatusResponse.create({ ok: false, authenticated: false, message: String(error) })
	}
}
