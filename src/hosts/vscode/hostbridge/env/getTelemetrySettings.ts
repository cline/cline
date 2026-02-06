import * as vscode from "vscode"
import type { ErrorSettings } from "@/services/error"
import type { EmptyRequest } from "@/shared/proto/index.cline"
import { type GetTelemetrySettingsResponse, Setting } from "@/shared/proto/index.host"

export async function getTelemetrySettings(_: EmptyRequest): Promise<GetTelemetrySettingsResponse> {
	const config = vscode.workspace.getConfiguration("telemetry")
	const errorLevel = config?.get<ErrorSettings["level"]>("telemetryLevel") || "all"

	if (vscode.env.isTelemetryEnabled) {
		return { isEnabled: Setting.ENABLED, errorLevel }
	}
	return { isEnabled: Setting.DISABLED, errorLevel }
}
