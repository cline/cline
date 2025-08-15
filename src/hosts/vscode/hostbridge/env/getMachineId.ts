import { EmptyRequest, String } from "@shared/proto/cline/common"
import * as vscode from "vscode"

export async function getMachineId(_: EmptyRequest): Promise<String> {
	const id = vscode.env.machineId || ""
	return String.create({ value: id })
}
