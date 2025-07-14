import * as vscode from "vscode"
import { EmptyRequest } from "@/shared/proto/common"
import { String as ProtoString } from "@/shared/proto/common"

export async function getVersion(request: EmptyRequest): Promise<ProtoString> {
	return ProtoString.create({
		value: vscode.version,
	})
}
