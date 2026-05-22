import type { EmptyRequest } from "@shared/proto/cline/common"
import { GeeStatusResponse } from "@shared/proto/cline/ui"
import { GeeService } from "@/services/gee/GeeService"
import type { Controller } from "../index"

export async function getGeeStatus(_controller: Controller, _request: EmptyRequest): Promise<GeeStatusResponse> {
	try {
		const result = await GeeService.status()
		const runtime = (result as any).runtime as { ee_version?: string; python_executable?: string } | undefined
		return GeeStatusResponse.create({
			ok: result.ok,
			authenticated: result.authenticated ?? false,
			projectId: result.project_id ?? "",
			eeVersion: runtime?.ee_version ?? "",
			pythonExecutable: runtime?.python_executable ?? "",
			message: result.message ?? "",
		})
	} catch (error) {
		return GeeStatusResponse.create({ ok: false, authenticated: false, message: String(error) })
	}
}
