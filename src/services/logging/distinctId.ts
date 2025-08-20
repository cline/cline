import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"

// Prefer host-provided UUID when running via HostBridge; fall back to VS Code's machineId, then a random UUID
let _distinctId = process?.env?.UUID ?? vscode?.env?.machineId ?? uuidv4()

export function setDistinctId(newId: string) {
	_distinctId = newId
}

export const getDistinctId = () => _distinctId
