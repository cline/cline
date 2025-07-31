import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"

export const ENV_UID = vscode?.env?.machineId ?? uuidv4()
