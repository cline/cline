import * as vscode from "vscode"
import type { EmptyRequest } from "@/shared/proto/index.cline"
import { type GetTelemetrySettingsResponse, Setting } from "@/shared/proto/index.host"

export async function getTelemetrySettings(_: EmptyRequest): Promise<GetTelemetrySettingsResponse> {
	if (vscode.env.isTelemetryEnabled) {
		return { isEnabled: Setting.ENABLED }
	}
	return { isEnabled: Setting.DISABLED }
}
