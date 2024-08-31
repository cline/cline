// FileUtils.ts
import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"

export const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop")

export function getReadablePath(relPath: string): string {
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