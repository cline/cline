import { Anthropic } from "@anthropic-ai/sdk";
import cloneDeep from "clone-deep";
import delay from "delay";
import fs from "fs/promises";
import getFolderSize from "get-folder-size";
import os from "os";
import pWaitFor from "p-wait-for";
import * as path from "path";
import { serializeError } from "serialize-error";
import * as vscode from "vscode";
import { ApiHandler, buildApiHandler } from "../api";
import { OpenAiHandler } from "../api/providers/openai";
import { OpenRouterHandler } from "../api/providers/openrouter";
import { ApiStream } from "../api/transform/stream";
import CheckpointTracker from "../integrations/checkpoints/CheckpointTracker";
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "../integrations/editor/DiffViewProvider";
import { findToolName, formatContentBlockToMarkdown } from "../integrations/misc/export-markdown";
import { extractTextFromFile } from "../integrations/misc/extract-text";
import { showSystemNotification } from "../integrations/notifications";
import { TerminalManager } from "../integrations/terminal/TerminalManager";
import { BrowserSession } from "../services/browser/BrowserSession";
import { UrlContentFetcher } from "../services/browser/UrlContentFetcher";
import { listFiles } from "../services/glob/list-files";
import { regexSearchFiles } from "../services/ripgrep";
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter";
import { ApiConfiguration } from "../shared/api";
import { findLast, findLastIndex } from "../shared/array";
import { AutoApprovalSettings } from "../shared/AutoApprovalSettings";
import { BrowserSettings } from "../shared/BrowserSettings";
import { ChatSettings } from "../shared/ChatSettings";
import { combineApiRequests } from "../shared/combineApiRequests";
import { combineCommandSequences, COMMAND_REQ_APP_STRING } from "../shared/combineCommandSequences";
import {
    BrowserAction,
    BrowserActionResult,
    browserActions,
    ClineApiReqCancelReason,
    ClineApiReqInfo,
    ClineAsk,
    ClineAskUseMcpServer,
    ClineMessage,
    ClineSay,
    ClineSayBrowserAction,
    ClineSayTool,
    COMPLETION_RESULT_CHANGES_FLAG,
} from "../shared/ExtensionMessage";
import { getApiMetrics } from "../shared/getApiMetrics";
import { HistoryItem } from "../shared/HistoryItem";
import { ClineAskResponse, ClineCheckpointRestore } from "../shared/WebviewMessage";
import { calculateApiCost } from "../utils/cost";
import { fileExistsAtPath } from "../utils/fs";
import { arePathsEqual, getReadablePath } from "../utils/path";
import { fixModelHtmlEscaping, removeInvalidChars } from "../utils/string";
import { AssistantMessageContent, parseAssistantMessage, ToolParamName, ToolUseName } from "./assistant-message";
import { constructNewFileContent } from "./assistant-message/diff";
import { ClineIgnoreController, LOCK_TEXT_SYMBOL } from "./ignore/ClineIgnoreController";
import { parseMentions } from "./mentions";
import { formatResponse } from "./prompts/responses";
import { addUserInstructions, SYSTEM_PROMPT } from "./prompts/system";
import { getNextTruncationRange, getTruncatedMessages } from "./sliding-window";
import { ClineProvider, GlobalFileNames } from "./webview/ClineProvider";
import { ClineTaskManager } from "./ClineTaskManager";
import { ClineFileManager } from "./ClineFileManager";
import { ClineApiManager } from "./ClineApiManager";
import { ClineUserInteraction } from "./ClineUserInteraction";
import { ClineToolManager } from "./ClineToolManager";

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop");

type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;
type UserContent = Array<
    Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
>;

export class Cline {
    readonly taskId: string;
    api: ApiHandler;
    private terminalManager: TerminalManager;
    private urlContentFetcher: UrlContentFetcher;
    browserSession: BrowserSession;
    private didEditFile: boolean = false;
    customInstructions?: string;
    autoApprovalSettings: AutoApprovalSettings;
    private browserSettings: BrowserSettings;
    private chatSettings: ChatSettings;
    apiConversationHistory: Anthropic.MessageParam[] = [];
    clineMessages: ClineMessage[] = [];
    private clineIgnoreController: ClineIgnoreController;
    private askResponse?: ClineAskResponse;
    private askResponseText?: string;
    private askResponseImages?: string[];
    private lastMessageTs?: number;
    private consecutiveAutoApprovedRequestsCount: number = 0;
    private consecutiveMistakeCount: number = 0;
    private providerRef: WeakRef<ClineProvider>;
    private abort: boolean = false;
    didFinishAbortingStream = false;
    abandoned = false;
    private diffViewProvider: DiffViewProvider;
    private checkpointTracker?: CheckpointTracker;
    checkpointTrackerErrorMessage?: string;
    conversationHistoryDeletedRange?: [number, number];
    isInitialized = false;
    isAwaitingPlanResponse = false;
    didRespondToPlanAskBySwitchingMode = false;

    // streaming
    isWaitingForFirstChunk = false;
    isStreaming = false;
    private currentStreamingContentIndex = 0;
    private assistantMessageContent: AssistantMessageContent[] = [];
    private presentAssistantMessageLocked = false;
    private presentAssistantMessageHasPendingUpdates = false;
    private userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [];
    private userMessageContentReady = false;
    private didRejectTool = false;
    private didAlreadyUseTool = false;
    private didCompleteReadingStream = false;
    private didAutomaticallyRetryFailedApiRequest = false;

    private taskManager: ClineTaskManager;
    private fileManager: ClineFileManager;
    private apiManager: ClineApiManager;
    private userInteraction: ClineUserInteraction;
    private toolManager: ClineToolManager;

    constructor(
        provider: ClineProvider,
        apiConfiguration: ApiConfiguration,
        autoApprovalSettings: AutoApprovalSettings,
        browserSettings: BrowserSettings,
        chatSettings: ChatSettings,
        customInstructions?: string,
        task?: string,
        images?: string[],
        historyItem?: HistoryItem,
    ) {
        this.clineIgnoreController = new ClineIgnoreController(cwd);
        this.clineIgnoreController.initialize().catch((error) => {
            console.error("Failed to initialize ClineIgnoreController:", error);
        });
        this.providerRef = new WeakRef(provider);
        this.api = buildApiHandler(apiConfiguration);
        this.terminalManager = new TerminalManager();
        this.urlContentFetcher = new UrlContentFetcher(provider.context);
        this.browserSession = new BrowserSession(provider.context, browserSettings);
        this.diffViewProvider = new DiffViewProvider(cwd);
        this.customInstructions = customInstructions;
        this.autoApprovalSettings = autoApprovalSettings;
        this.browserSettings = browserSettings;
        this.chatSettings = chatSettings;
        this.taskManager = new ClineTaskManager();
        this.fileManager = new ClineFileManager();
        this.apiManager = new ClineApiManager();
        this.userInteraction = new ClineUserInteraction();
        this.toolManager = new ClineToolManager();

        if (historyItem) {
            this.taskId = historyItem.id;
            this.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange;
            this.resumeTaskFromHistory();
        } else if (task || images) {
            this.taskId = Date.now().toString();
            this.taskManager.startTask(task || "defaultTask", images);

        } else {
            throw new Error("Either historyItem or task/images must be provided");
        }
    }

    resumeTaskFromHistory() {
        // Logic to resume a task from history
        this.taskManager.resumeTask();
    }

    updateBrowserSettings(browserSettings: BrowserSettings) {
        // Logic to update browser settings
        console.log("Updating browser settings...");
        // Implement the actual update logic here
    }

    handleWebviewAskResponse(askResponse: ClineAskResponse, text: string, images?: string[]) {
        // Logic to handle webview ask response
        console.log("Handling webview ask response...");
        // Implement the actual handling logic here
    }

    presentMultifileDiff(number: number, isFinal: boolean) {
        // Logic to present a diff for multiple files
        console.log("Presenting multifile diff...");
        // Implement the actual presentation logic here
    }

    restoreCheckpoint(number: number, text: string) {
        // Logic to restore a checkpoint
        console.log("Restoring checkpoint...");
        // Implement the actual restoration logic here
    }

    updateChatSettings(chatSettings: ChatSettings) {
        // Logic to update chat settings
        console.log("Updating chat settings...");
        // Implement the actual update logic here
    }

    abortTask() {
        // Logic to abort the current task
        console.log("Aborting task...");
        // Implement the actual abort logic here
    }


}
