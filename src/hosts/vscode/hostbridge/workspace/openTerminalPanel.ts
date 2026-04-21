import { OpenTerminalRequest, OpenTerminalResponse } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"

export async function openTerminalPanel(_: OpenTerminalRequest): Promise<OpenTerminalResponse> {
	Logger.warn("openTerminalPanel called after integrated-terminal removal; ignoring request")
	return {}
}
