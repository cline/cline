import { Anthropic } from "@anthropic-ai/sdk"
import cloneDeep from "clone-deep"
import delay from "delay"
import fs from "fs/promises"
import os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { ApiHandler, buildApiHandler } from "../../api"
import { ApiStream } from "../../api/transform/stream"
import { DiffViewProvider } from "../../integrations/editor/DiffViewProvider"
import { findToolName, formatContentBlockToMarkdown } from "../../integrations/misc/export-markdown"
import { TerminalManager } from "../../integrations/terminal/TerminalManager"
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { listFiles } from "../../services/glob/list-files"
import { ApiConfiguration } from "../../shared/api"
import { findLastIndex } from "../../shared/array"
import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import {
	ClineApiReqCancelReason,
	ClineApiReqInfo,
	ClineAsk,
	ClineMessage,
	ClineSay,
} from "../../shared/ExtensionMessage"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { HistoryItem } from "../../shared/HistoryItem"
import { ClineAskResponse } from "../../shared/WebviewMessage"
import { calculateApiCost } from "../../utils/cost"
import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { parseMentions } from "../mentions"
import { AssistantMessageContent, parseAssistantMessage, ToolUseName } from "../assistant-message"
import { formatResponse } from "../prompts/responses"
import { addCustomInstructions, SYSTEM_PROMPT } from "../prompts/system"
import { truncateHalfConversation } from "../sliding-window"
import { ClineProvider, GlobalFileNames } from "../webview/ClineProvider"
import { presentAssistantMessageContent } from "./presentAssistantMessageContent"
import { UserContent, ToolResponse } from "./clineTypes"

export async function handleConsecutiveMistakes(
	consecutiveMistakeCount: number,
	apiModelId: string,
	ask: (type: ClineAsk, text?: string) => Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>,
	say: (type: ClineSay, text?: string, images?: string[]) => Promise<undefined>,
	userContent: UserContent,
): Promise<number> {
	if (consecutiveMistakeCount >= 3) {
		const { response, text, images } = await ask(
		"mistake_limit_reached",
		apiModelId.includes("claude")
			? `This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
			: "Cline uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 3.5 Sonnet for its advanced agentic coding capabilities."
		)
		if (response === "messageResponse") {
		userContent.push(
			...[
			{
				type: "text",
				text: formatResponse.tooManyMistakes(text),
			} as Anthropic.Messages.TextBlockParam,
			...formatResponse.imageBlocks(images),
			]
		)
		}
		return 0 // Reset consecutive mistake count
	}
	return consecutiveMistakeCount
}

interface EnvironmentDetailsOptions {
  cwd: string;
  includeFileDetails: boolean;
  terminalManager: TerminalManager;
  didEditFile: boolean;
  urlContentFetcher: UrlContentFetcher;
}

export async function loadContext(
  userContent: UserContent,
  cwd: string,
  urlContentFetcher: UrlContentFetcher
): Promise<[UserContent, string]> {
  const processedUserContent = await Promise.all(
    userContent.map(async (block) => {
      if (block.type === "text") {
        return {
          ...block,
          text: await parseMentions(block.text, cwd, urlContentFetcher),
        };
      } else if (block.type === "tool_result") {
        const isUserMessage = (text: string) => text.includes("<feedback>") || text.includes("<answer>");
        if (typeof block.content === "string" && isUserMessage(block.content)) {
          return {
            ...block,
            content: await parseMentions(block.content, cwd, urlContentFetcher),
          };
        } else if (Array.isArray(block.content)) {
          const parsedContent = await Promise.all(
            block.content.map(async (contentBlock) => {
              if (contentBlock.type === "text" && isUserMessage(contentBlock.text)) {
                return {
                  ...contentBlock,
                  text: await parseMentions(contentBlock.text, cwd, urlContentFetcher),
                };
              }
              return contentBlock;
            })
          );
          return {
            ...block,
            content: parsedContent,
          };
        }
      }
      return block;
    })
  );

  const environmentDetails = await getEnvironmentDetails({
    cwd,
    includeFileDetails: true,
    terminalManager: new TerminalManager(), // This should be passed from Cline
    didEditFile: false, // This should be passed from Cline
    urlContentFetcher,
  });

  return [processedUserContent, environmentDetails];
}

export async function getEnvironmentDetails(options: EnvironmentDetailsOptions): Promise<string> {
  const { cwd, includeFileDetails, terminalManager, didEditFile, urlContentFetcher } = options;
  let details = "";

  // VSCode Visible Files
  details += "\n\n# VSCode Visible Files";
  const visibleFiles = vscode.window.visibleTextEditors
    ?.map((editor) => editor.document?.uri?.fsPath)
    .filter(Boolean)
    .map((absolutePath) => path.relative(cwd, absolutePath).toPosix())
    .join("\n");
  details += visibleFiles ? `\n${visibleFiles}` : "\n(No visible files)";

  // VSCode Open Tabs
  details += "\n\n# VSCode Open Tabs";
  const openTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
    .filter(Boolean)
    .map((absolutePath) => path.relative(cwd, absolutePath).toPosix())
    .join("\n");
  details += openTabs ? `\n${openTabs}` : "\n(No open tabs)";

  // Terminal details
  const busyTerminals = terminalManager.getTerminals(true);
  const inactiveTerminals = terminalManager.getTerminals(false);

  if (busyTerminals.length > 0 && didEditFile) {
    await delay(300);
  }

  if (busyTerminals.length > 0) {
    await pWaitFor(() => busyTerminals.every((t) => !terminalManager.isProcessHot(t.id)), {
      interval: 100,
      timeout: 15_000,
    }).catch(() => {});
  }

  let terminalDetails = "";
  if (busyTerminals.length > 0) {
    terminalDetails += "\n\n# Actively Running Terminals";
    for (const busyTerminal of busyTerminals) {
      terminalDetails += `\n## Original command: \`${busyTerminal.lastCommand}\``;
      const newOutput = terminalManager.getUnretrievedOutput(busyTerminal.id);
      if (newOutput) {
        terminalDetails += `\n### New Output\n${newOutput}`;
      }
    }
  }

  if (inactiveTerminals.length > 0) {
    const inactiveTerminalOutputs = new Map<number, string>();
    for (const inactiveTerminal of inactiveTerminals) {
      const newOutput = terminalManager.getUnretrievedOutput(inactiveTerminal.id);
      if (newOutput) {
        inactiveTerminalOutputs.set(inactiveTerminal.id, newOutput);
      }
    }
    if (inactiveTerminalOutputs.size > 0) {
      terminalDetails += "\n\n# Inactive Terminals";
      for (const [terminalId, newOutput] of inactiveTerminalOutputs) {
        const inactiveTerminal = inactiveTerminals.find((t) => t.id === terminalId);
        if (inactiveTerminal) {
          terminalDetails += `\n## ${inactiveTerminal.lastCommand}`;
          terminalDetails += `\n### New Output\n${newOutput}`;
        }
      }
    }
  }

  if (terminalDetails) {
    details += terminalDetails;
  }

  if (includeFileDetails) {
    details += `\n\n# Current Working Directory (${cwd.toPosix()}) Files\n`;
    const isDesktop = arePathsEqual(cwd, path.join(os.homedir(), "Desktop"));
    if (isDesktop) {
      details += "(Desktop files not shown automatically. Use list_files to explore if needed.)";
    } else {
      const [files, didHitLimit] = await listFiles(cwd, true, 200);
      const result = formatResponse.formatFilesList(cwd, files, didHitLimit);
      details += result;
    }
  }

  return `<environment_details>\n${details.trim()}\n</environment_details>`;
}
