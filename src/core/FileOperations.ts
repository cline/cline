// FileOperations.ts
import { ToolResponse } from "../shared/ToolResponse"
import { ClaudeDevCore } from "../shared/ClaudeDevCore"
import { FileOperations } from "../shared/FileOperations"
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as diff from "diff"
import { serializeError } from "serialize-error"
import { extractTextFromFile } from "../utils/extract-text"
import { listFiles, parseSourceCodeForDefinitionsTopLevel, LIST_FILES_LIMIT } from "../parse-source-code"
import { regexSearchFiles } from "../utils/ripgrep"
import { ClaudeSayTool } from "../shared/ExtensionMessage"
import { ClaudeAskResponse } from "../shared/WebviewMessage"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop")

export class FileOperationsImpl implements FileOperations {
  constructor(private core: ClaudeDevCore) {}

  async writeToFile(relPath?: string, newContent?: string): Promise<ToolResponse> {
    if (relPath === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use write_to_file without value for required parameter 'path'. Retrying..."
      )
      return "Error: Missing value for required parameter 'path'. Please retry with complete response."
    }

    if (newContent === undefined) {
      await this.core.say(
        "error",
        `Claude tried to use write_to_file for '${relPath}' without value for required parameter 'content'. This is likely due to output token limits. Retrying...`
      )
      return "Error: Missing value for required parameter 'content'. Please retry with complete response."
    }

    try {
      const absolutePath = path.resolve(cwd, relPath)
      const fileExists = await fs
        .access(absolutePath)
        .then(() => true)
        .catch(() => false)

      let originalContent: string
      if (fileExists) {
        originalContent = await fs.readFile(absolutePath, "utf-8")
        const eol = originalContent.includes("\r\n") ? "\r\n" : "\n"
        if (originalContent.endsWith(eol) && !newContent.endsWith(eol)) {
          newContent += eol
        }
      } else {
        originalContent = ""
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-dev-"))
      const tempFilePath = path.join(tempDir, path.basename(absolutePath))
      await fs.writeFile(tempFilePath, newContent)

      vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.parse(`claude-dev-diff:${path.basename(absolutePath)}`).with({
          query: Buffer.from(originalContent).toString("base64"),
        }),
        vscode.Uri.file(tempFilePath),
        `${path.basename(absolutePath)}: ${fileExists ? "Original ↔ Claude's Changes" : "New File"} (Editable)`
      )

      let userResponse: {
        response: ClaudeAskResponse
        text?: string
        images?: string[]
      }
      if (fileExists) {
        userResponse = await this.core.ask(
          "tool",
          JSON.stringify({
            tool: "editedExistingFile",
            path: this.getReadablePath(relPath),
            diff: this.createPrettyPatch(relPath, originalContent, newContent),
          } as ClaudeSayTool)
        )
      } else {
        userResponse = await this.core.ask(
          "tool",
          JSON.stringify({
            tool: "newFileCreated",
            path: this.getReadablePath(relPath),
            content: newContent,
          } as ClaudeSayTool)
        )
      }
      const { response, text, images } = userResponse

      // Save any unsaved changes in the diff editor
      const diffDocument = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === tempFilePath)
      if (diffDocument && diffDocument.isDirty) {
        console.log("saving diff document")
        await diffDocument.save()
      }

      if (response !== "yesButtonTapped") {
        await this.closeDiffViews()
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch (error) {
          console.error(`Error deleting temporary directory: ${error}`)
        }
        if (response === "messageResponse") {
          await this.core.say("user_feedback", text, images)
          return this.core.formatIntoToolResponse(await this.core.formatGenericToolFeedback(text), images)
        }
        return "The user denied this operation."
      }

      const editedContent = await fs.readFile(tempFilePath, "utf-8")
      if (!fileExists) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true })
      }
      await fs.writeFile(absolutePath, editedContent)

      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (error) {
        console.error(`Error deleting temporary directory: ${error}`)
      }

      await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
      await this.closeDiffViews()

      if (editedContent !== newContent) {
        const diffResult = diff.createPatch(relPath, originalContent, editedContent)
        const userDiff = diff.createPatch(relPath, newContent, editedContent)
        await this.core.say(
          "user_feedback_diff",
          JSON.stringify({
            tool: fileExists ? "editedExistingFile" : "newFileCreated",
            path: this.getReadablePath(relPath),
            diff: this.createPrettyPatch(relPath, newContent, editedContent),
          } as ClaudeSayTool)
        )
        return `The user accepted but made the following changes to your content:\n\n${userDiff}\n\nFinal result ${
          fileExists ? "applied to" : "written as new file"
        } ${relPath}:\n\n${diffResult}`
      } else {
        const diffResult = diff.createPatch(relPath, originalContent, newContent)
        return `${
          fileExists ? `Changes applied to ${relPath}:\n\n${diffResult}` : `New file written to ${relPath}`
        }`
      }
    } catch (error) {
      const errorString = `Error writing file: ${JSON.stringify(serializeError(error))}`
      await this.core.say(
        "error",
        `Error writing file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
      )
      return errorString
    }
  }

  async readFile(relPath?: string): Promise<ToolResponse> {
    if (relPath === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use read_file without value for required parameter 'path'. Retrying..."
      )
      return "Error: Missing value for required parameter 'path'. Please retry with complete response."
    }
    try {
      const absolutePath = path.resolve(cwd, relPath)
      const content = await extractTextFromFile(absolutePath)

      const message = JSON.stringify({
        tool: "readFile",
        path: this.getReadablePath(relPath),
        content,
      } as ClaudeSayTool)
      if (this.core.alwaysAllowReadOnly) {
        await this.core.say("tool", message)
      } else {
        const { response, text, images } = await this.core.ask("tool", message)
        if (response !== "yesButtonTapped") {
          if (response === "messageResponse") {
            await this.core.say("user_feedback", text, images)
            return this.core.formatIntoToolResponse(await this.core.formatGenericToolFeedback(text), images)
          }
          return "The user denied this operation."
        }
      }

      return content
    } catch (error) {
      const errorString = `Error reading file: ${JSON.stringify(serializeError(error))}`
      await this.core.say(
        "error",
        `Error reading file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
      )
      return errorString
    }
  }

  async listFiles(relDirPath?: string, recursiveRaw?: string): Promise<ToolResponse> {
    if (relDirPath === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use list_files without value for required parameter 'path'. Retrying..."
      )
      return "Error: Missing value for required parameter 'path'. Please retry with complete response."
    }
    try {
      const recursive = recursiveRaw?.toLowerCase() === "true"
      const absolutePath = path.resolve(cwd, relDirPath)
      const files = await listFiles(absolutePath, recursive)
      const result = this.formatFilesList(absolutePath, files, LIST_FILES_LIMIT)

      const message = JSON.stringify({
        tool: recursive ? "listFilesRecursive" : "listFilesTopLevel",
        path: this.getReadablePath(relDirPath),
        content: result,
      } as ClaudeSayTool)
      if (this.core.alwaysAllowReadOnly) {
        await this.core.say("tool", message)
      } else {
        const { response, text, images } = await this.core.ask("tool", message)
        if (response !== "yesButtonTapped") {
          if (response === "messageResponse") {
            await this.core.say("user_feedback", text, images)
            return this.core.formatIntoToolResponse(await this.core.formatGenericToolFeedback(text), images)
          }
          return "The user denied this operation."
        }
      }

      return result
    } catch (error) {
      const errorString = `Error listing files and directories: ${JSON.stringify(serializeError(error))}`
      await this.core.say(
        "error",
        `Error listing files and directories:\n${
          error.message ?? JSON.stringify(serializeError(error), null, 2)
        }`
      )
      return errorString
    }
  }

  async listCodeDefinitionNames(relDirPath?: string): Promise<ToolResponse> {
    if (relDirPath === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use list_code_definition_names without value for required parameter 'path'. Retrying..."
      )
      return "Error: Missing value for required parameter 'path'. Please retry with complete response."
    }
    try {
      const absolutePath = path.resolve(cwd, relDirPath)
      const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)

      const message = JSON.stringify({
        tool: "listCodeDefinitionNames",
        path: this.getReadablePath(relDirPath),
        content: result,
      } as ClaudeSayTool)
      if (this.core.alwaysAllowReadOnly) {
        await this.core.say("tool", message)
      } else {
        const { response, text, images } = await this.core.ask("tool", message)
        if (response !== "yesButtonTapped") {
          if (response === "messageResponse") {
            await this.core.say("user_feedback", text, images)
            return this.core.formatIntoToolResponse(await this.core.formatGenericToolFeedback(text), images)
          }
          return "The user denied this operation."
        }
      }

      return result
    } catch (error) {
      const errorString = `Error parsing source code definitions: ${JSON.stringify(serializeError(error))}`
      await this.core.say(
        "error",
        `Error parsing source code definitions:\n${
          error.message ?? JSON.stringify(serializeError(error), null, 2)
        }`
      )
      return errorString
    }
  }

  async searchFiles(relDirPath: string, regex: string, filePattern?: string): Promise<ToolResponse> {
    if (relDirPath === undefined) {
      await this.core.say(
        "error",
        "Claude tried to use search_files without value for required parameter 'path'. Retrying..."
      )
      return "Error: Missing value for required parameter 'path'. Please retry with complete response."
    }

    if (regex === undefined) {
      await this.core.say(
        "error",
        `Claude tried to use search_files without value for required parameter 'regex'. Retrying...`
      )
      return "Error: Missing value for required parameter 'regex'. Please retry with complete response."
    }

    try {
      const absolutePath = path.resolve(cwd, relDirPath)
      const results = await regexSearchFiles(cwd, absolutePath, regex, filePattern)

      const message = JSON.stringify({
        tool: "searchFiles",
        path: this.getReadablePath(relDirPath),
        regex: regex,
        filePattern: filePattern,
        content: results,
      } as ClaudeSayTool)

      if (this.core.alwaysAllowReadOnly) {
        await this.core.say("tool", message)
      } else {
        const { response, text, images } = await this.core.ask("tool", message)
        if (response !== "yesButtonTapped") {
          if (response === "messageResponse") {
            await this.core.say("user_feedback", text, images)
            return this.core.formatIntoToolResponse(await this.core.formatGenericToolFeedback(text), images)
          }
          return "The user denied this operation."
        }
      }

      return results
    } catch (error) {
      const errorString = `Error searching files: ${JSON.stringify(serializeError(error))}`
      await this.core.say(
        "error",
        `Error searching files:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
      )
      return errorString
    }
  }

  // Helper methods
  getReadablePath(relPath: string): string {
    const absolutePath = path.resolve(cwd, relPath)
    if (cwd === path.join(os.homedir(), "Desktop")) {
      return absolutePath
    }
    if (path.normalize(absolutePath) === path.normalize(cwd)) {
      return path.basename(absolutePath)
    } else {
      const normalizedRelPath = path.relative(cwd, absolutePath)
      if (absolutePath.includes(cwd)) {
        return normalizedRelPath
      } else {
        return absolutePath
      }
    }
  }

  formatFilesList(absolutePath: string, files: string[], LIST_FILES_LIMIT: number): string {
    const sorted = files
      .map((file) => {
        const relativePath = path.relative(absolutePath, file)
        return file.endsWith("/") ? relativePath + "/" : relativePath
      })
      .sort((a, b) => {
        const aParts = a.split("/")
        const bParts = b.split("/")
        for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
          if (aParts[i] !== bParts[i]) {
            if (i + 1 === aParts.length && i + 1 < bParts.length) {
              return -1
            }
            if (i + 1 === bParts.length && i + 1 < aParts.length) {
              return 1
            }
            return aParts[i].localeCompare(bParts[i], undefined, { numeric: true, sensitivity: "base" })
          }
        }
        return aParts.length - bParts.length
      })
    if (sorted.length >= LIST_FILES_LIMIT) {
      const truncatedList = sorted.slice(0, LIST_FILES_LIMIT).join("\n")
      return `${truncatedList}\n\n(Truncated at ${LIST_FILES_LIMIT} results. Try listing files in subdirectories if you need to explore further.)`
    } else if (sorted.length === 0 || (sorted.length === 1 && sorted[0] === "")) {
      return "No files found or you do not have permission to view this directory."
    } else {
      return sorted.join("\n")
    }
  }

  createPrettyPatch(filename = "file", oldStr: string, newStr: string) {
    const patch = diff.createPatch(filename, oldStr, newStr)
    const lines = patch.split("\n")
    const prettyPatchLines = lines.slice(4)
    return prettyPatchLines.join("\n")
  }

  async closeDiffViews() {
    const tabs = vscode.window.tabGroups.all
      .map((tg) => tg.tabs)
      .flat()
      .filter((tab) => {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          const originalPath = (tab.input.original as vscode.Uri).toString()
          const modifiedPath = (tab.input.modified as vscode.Uri).toString()
          return originalPath.includes("claude-dev-") || modifiedPath.includes("claude-dev-")
        }
        return false
      })

    for (const tab of tabs) {
      await vscode.window.tabGroups.close(tab)
    }
  }
}