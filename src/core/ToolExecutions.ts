// ToolExecutions.ts
import { ToolResponse } from "../shared/ToolResponse"
import { ClaudeDevCore } from "../shared/ClaudeDevCore"
import { ToolExecutions } from "../shared/ToolExecutions"
import { ToolName } from "../shared/Tool"
import { execa, ExecaError, ResultPromise } from "execa"
import delay from "delay"
import treeKill from "tree-kill"
import { serializeError } from "serialize-error"

export class ToolExecutionsImpl implements ToolExecutions {
  constructor(private core: ClaudeDevCore) {}

  async executeTool(toolName: ToolName, toolInput: any): Promise<ToolResponse> {
    switch (toolName) {
      case "write_to_file":
        return this.core.writeToFile(toolInput.path, toolInput.content)
      case "read_file":
        return this.core.readFile(toolInput.path)
      case "list_files":
        return this.core.listFiles(toolInput.path, toolInput.recursive)
      case "list_code_definition_names":
        return this.core.listCodeDefinitionNames(toolInput.path)
      case "search_files":
        return this.core.searchFiles(toolInput.path, toolInput.regex, toolInput.filePattern)
      case "execute_command":
        return this.executeCommand(toolInput.command)
      case "ask_followup_question":
        return this.askFollowupQuestion(toolInput.question)
      case "attempt_completion":
        return this.attemptCompletion(toolInput.result, toolInput.command)
      default:
        return `Unknown tool: ${toolName}`
    }
  }

  async executeCommand(command?: string, returnEmptyStringOnSuccess: boolean = false): Promise<ToolResponse> {
    if (command === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use execute_command without value for required parameter 'command'. Retrying..."
      )
      return "Error: Missing value for required parameter 'command'. Please retry with complete response."
    }
    const { response, text, images } = await this.core.ask("command", command)
    if (response !== "yesButtonTapped") {
      if (response === "messageResponse") {
        await this.core.say("user_feedback", text, images)
        return this.core.formatIntoToolResponse(await this.core.formatGenericToolFeedback(text), images)
      }
      return "The user denied this operation."
    }

    const sendCommandOutput = async (subprocess: ResultPromise, line: string): Promise<void> => {
      try {
        const { response, text } = await this.core.ask("command_output", line)
        if (response === "yesButtonTapped") {
          if (subprocess.pid) {
            treeKill(subprocess.pid, "SIGINT")
          }
        } else {
          subprocess.stdin?.write(text + "\n")
          sendCommandOutput(subprocess, "")
        }
      } catch {
        // This can only happen if this ask promise was ignored, so ignore this error
      }
    }

    try {
      let result = ""
      const subprocess = execa({ shell: true, cwd: this.core.cwd })`${command}`
      this.core.executeCommandRunningProcess = subprocess

      subprocess.stdout?.on("data", (data) => {
        if (data) {
          const output = data.toString()
          sendCommandOutput(subprocess, output)
          result += output
        }
      })

      try {
        await subprocess
      } catch (e) {
        if ((e as ExecaError).signal === "SIGINT") {
          await this.core.say("command_output", `\nUser exited command...`)
          result += `\n====\nUser terminated command process via SIGINT. This is not an error. Please continue with your task, but keep in mind that the command is no longer running. For example, if this command was used to start a server for a react app, the server is no longer running and you cannot open a browser to view it anymore.`
        } else {
          throw e
        }
      }
      await delay(100)
      this.core.executeCommandRunningProcess = undefined
      if (returnEmptyStringOnSuccess) {
        return ""
      }
      return `Command Output:\n${result}`
    } catch (e) {
      const error = e as any
      let errorMessage = error.message || JSON.stringify(serializeError(error), null, 2)
      const errorString = `Error executing command:\n${errorMessage}`
      await this.core.say("error", `Error executing command:\n${errorMessage}`)
      this.core.executeCommandRunningProcess = undefined
      return errorString
    }
  }

  async askFollowupQuestion(question?: string): Promise<ToolResponse> {
    if (question === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use ask_followup_question without value for required parameter 'question'. Retrying..."
      )
      return "Error: Missing value for required parameter 'question'. Please retry with complete response."
    }
    const { text, images } = await this.core.ask("followup", question)
    await this.core.say("user_feedback", text ?? "", images)
    return this.core.formatIntoToolResponse(`<answer>\n${text}\n</answer>`, images)
  }

  async attemptCompletion(result?: string, command?: string): Promise<ToolResponse> {
    if (result === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use attempt_completion without value for required parameter 'result'. Retrying..."
      )
      return "Error: Missing value for required parameter 'result'. Please retry with complete response."
    }
    let resultToSend = result
    if (command) {
      await this.core.say("completion_result", resultToSend)
      const commandResult = await this.executeCommand(command, true)
      if (commandResult) {
        return commandResult
      }
      resultToSend = ""
    }
    const { response, text, images } = await this.core.ask("completion_result", resultToSend)
    if (response === "yesButtonTapped") {
      return ""
    }
    await this.core.say("user_feedback", text ?? "", images)
    return this.core.formatIntoToolResponse(
      `The user is not pleased with the results. Use the feedback they provided to successfully complete the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
      images
    )
  }
}