import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

export async function openThirdPartyNotices(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await openFileIntegration(path.join(HostProvider.get().extensionFsPath, "dist", "THIRD_PARTY_NOTICES.txt"))
	return Empty.create()
}
