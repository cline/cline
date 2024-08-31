import { ToolResponse } from "./ToolResponse";


export interface FileOperations {
  writeToFile(relPath?: string, newContent?: string): Promise<ToolResponse>;
  readFile(relPath?: string): Promise<ToolResponse>;
  listFiles(relDirPath?: string, recursiveRaw?: string): Promise<ToolResponse>;
  listCodeDefinitionNames(relDirPath?: string): Promise<ToolResponse>;
  searchFiles(relDirPath: string, regex: string, filePattern?: string): Promise<ToolResponse>;
}
