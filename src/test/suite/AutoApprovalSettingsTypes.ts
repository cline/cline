import type { AutoApprovalSettings } from "../../shared/AutoApprovalSettings"
import type * as vscode from "vscode"

export interface ControllerLike {
	context: vscode.ExtensionContext
}

import * as sinon from "sinon"

export interface TaskLike {
	autoApprovalSettings: AutoApprovalSettings
	executeCommandTool: sinon.SinonStub<[string], Promise<[boolean, string]>>
}

export interface TerminalManagerLike {
	runCommand: sinon.SinonStub
	getOrCreateTerminal: sinon.SinonStub
}

export { AutoApprovalSettings }
