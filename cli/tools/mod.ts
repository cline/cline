/// <reference lib="deno.ns" />
import { join, dirname } from "https://deno.land/std@0.220.1/path/mod.ts";
import { red, yellow, green } from "https://deno.land/std@0.220.1/fmt/colors.ts";
import type { ToolResponse } from "../types.d.ts";

interface CommandConfig {
  desc: string;
  args: readonly string[];
}

// Define allowed commands and their descriptions
const ALLOWED_COMMANDS: Record<string, CommandConfig> = {
  'npm': {
    desc: "Node package manager",
    args: ["install", "run", "test", "build"]
  },
  'git': {
    desc: "Version control",
    args: ["status", "add", "commit", "push", "pull", "clone", "checkout", "branch"]
  },
  'deno': {
    desc: "Deno runtime",
    args: ["run", "test", "fmt", "lint", "check", "compile", "bundle"]
  },
  'ls': {
    desc: "List directory contents",
    args: ["-l", "-a", "-la", "-lh"]
  },
  'cat': {
    desc: "Show file contents",
    args: []
  },
  'echo': {
    desc: "Print text",
    args: []
  }
};

// Track commands that have been allowed for this session
const alwaysAllowedCommands = new Set<string>();

function isCommandAllowed(command: string): boolean {
  // Split command into parts
  const parts = command.trim().split(/\s+/);
  if (parts.length === 0) return false;

  // Get base command
  const baseCmd = parts[0];
  if (!(baseCmd in ALLOWED_COMMANDS)) return false;

  // If command has arguments, check if they're allowed
  if (parts.length > 1 && ALLOWED_COMMANDS[baseCmd].args.length > 0) {
    const arg = parts[1];
    return ALLOWED_COMMANDS[baseCmd].args.includes(arg);
  }

  return true;
}

async function promptForCommand(command: string): Promise<boolean> {
  // Check if command has been previously allowed
  if (alwaysAllowedCommands.has(command)) {
    console.log(yellow("\nWarning: Running previously allowed command:"), red(command));
    return true;
  }

  console.log(yellow("\nWarning: Command not in allowlist"));
  console.log("Command:", red(command));
  console.log("\nAllowed commands:");
  Object.entries(ALLOWED_COMMANDS).forEach(([cmd, { desc, args }]) => {
    console.log(`  ${green(cmd)}: ${desc}`);
    if (args.length) {
      console.log(`    Arguments: ${args.join(", ")}`);
    }
  });

  const answer = prompt("\nDo you want to run this command? (y/n/always) ");
  if (answer?.toLowerCase() === 'always') {
    alwaysAllowedCommands.add(command);
    return true;
  }
  return answer?.toLowerCase() === 'y';
}

export async function executeCommand(command: string): Promise<ToolResponse> {
  try {
    // Check if command is allowed
    if (!isCommandAllowed(command)) {
      // Prompt user for confirmation
      const shouldRun = await promptForCommand(command);
      if (!shouldRun) {
        return "Command execution cancelled by user";
      }
      console.log(yellow("\nProceeding with command execution..."));
    }

    const process = new Deno.Command("sh", {
      args: ["-c", command],
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, stderr } = await process.output();
    const decoder = new TextDecoder();
    return decoder.decode(stdout) + (stderr.length ? `\nStderr:\n${decoder.decode(stderr)}` : "");
  } catch (error) {
    return `Error executing command: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function readFile(workingDir: string, relativePath: string): Promise<ToolResponse> {
  try {
    const fullPath = join(workingDir, relativePath);
    const content = await Deno.readTextFile(fullPath);
    return content;
  } catch (error) {
    return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function writeFile(workingDir: string, relativePath: string, content: string): Promise<ToolResponse> {
  try {
    const fullPath = join(workingDir, relativePath);
    await Deno.mkdir(dirname(fullPath), { recursive: true });
    await Deno.writeTextFile(fullPath, content);
    return `Successfully wrote to ${relativePath}`;
  } catch (error) {
    return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function searchFiles(
  workingDir: string, 
  searchPath: string, 
  regex: string, 
  filePattern?: string
): Promise<ToolResponse> {
  try {
    const fullPath = join(workingDir, searchPath);
    const results: string[] = [];
    
    const regexObj = new RegExp(regex, "g");
    const patternObj = filePattern ? new RegExp(filePattern) : null;
    
    for await (const entry of Deno.readDir(fullPath)) {
      if (entry.isFile && (!patternObj || patternObj.test(entry.name))) {
        const filePath = join(fullPath, entry.name);
        const content = await Deno.readTextFile(filePath);
        const matches = content.match(regexObj);
        if (matches) {
          results.push(`File: ${entry.name}\nMatches:\n${matches.join("\n")}\n`);
        }
      }
    }
    
    return results.join("\n") || "No matches found";
  } catch (error) {
    return `Error searching files: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function listFiles(workingDir: string, relativePath: string, recursive: boolean): Promise<ToolResponse> {
  try {
    const fullPath = join(workingDir, relativePath);
    const files: string[] = [];

    async function* walkDir(dir: string): AsyncGenerator<string> {
      for await (const entry of Deno.readDir(dir)) {
        const entryPath = join(dir, entry.name);
        if (entry.isFile) {
          yield entryPath.replace(fullPath + "/", "");
        } else if (recursive && entry.isDirectory) {
          yield* walkDir(entryPath);
        }
      }
    }

    for await (const file of walkDir(fullPath)) {
      files.push(file);
    }

    return files.join("\n") || "No files found";
  } catch (error) {
    return `Error listing files: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function listCodeDefinitions(workingDir: string, relativePath: string): Promise<ToolResponse> {
  try {
    const fullPath = join(workingDir, relativePath);
    const content = await Deno.readTextFile(fullPath);
    
    // Basic regex patterns for common code definitions
    const patterns = {
      function: /(?:function|const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=\s*(?:function|\([^)]*\)\s*=>)|[({])/g,
      class: /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      method: /(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*{/g,
    };
    
    const definitions: Record<string, string[]> = {
      functions: [],
      classes: [],
      methods: [],
    };
    
    let match;
    
    while ((match = patterns.function.exec(content)) !== null) {
      definitions.functions.push(match[1]);
    }
    
    while ((match = patterns.class.exec(content)) !== null) {
      definitions.classes.push(match[1]);
    }
    
    while ((match = patterns.method.exec(content)) !== null) {
      definitions.methods.push(match[1]);
    }
    
    return Object.entries(definitions)
      .map(([type, names]) => `${type}:\n${names.join("\n")}`)
      .join("\n\n");
  } catch (error) {
    return `Error listing code definitions: ${error instanceof Error ? error.message : String(error)}`;
  }
}
