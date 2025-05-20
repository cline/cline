import { Package, CommandId, CodeActionId, TerminalActionId } from "../schemas"

export const getCommand = (id: CommandId) => `${Package.name}.${id}`

export const getCodeActionCommand = (id: CodeActionId) => `${Package.name}.${id}`

export const getTerminalCommand = (id: TerminalActionId) => `${Package.name}.${id}`
