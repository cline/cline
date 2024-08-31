// ErrorHandler.ts
import { serializeError } from "serialize-error"
import { ClaudeDevCore } from "../shared/ClaudeDevCore"

export async function handleError(core: ClaudeDevCore, errorType: string, error: any): Promise<string> {
  const errorMessage = error.message ?? JSON.stringify(serializeError(error), null, 2)
  const errorString = `Error ${errorType}: ${JSON.stringify(serializeError(error))}`
  await core.say("error", `Error ${errorType}:\n${errorMessage}`)
  return errorString
}

export function createErrorMessage(errorType: string, paramName: string): string {
  return `Claude tried to use ${errorType} without value for required parameter '${paramName}'. Retrying...`
}