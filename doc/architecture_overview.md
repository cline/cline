# Architecture Overview

## src/extension.ts

**File Path:** src/extension.ts

**Main Function:** Entry point for the Cline extension. Handles activation and deactivation of the extension, as well as providing the webview content.

**Exported Functions:**
- `activate(context: vscode.ExtensionContext)`: Activates the extension.
- `deactivate()`: Deactivates the extension.
- `provideTextDocumentContent(uri: vscode.Uri)`: Provides the content for the webview.


## src/api/index.ts

**File Path:** src/api/index.ts

**Main Function:** Provides the main API interface for interacting with different LLM providers.

**Exported Functions:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to the LLM.
- `getModel()`: Returns the currently selected LLM model.
- `buildApiHandler(configuration: ApiConfiguration)`: Builds an API handler for a specific LLM provider.


## src/api/providers/anthropic.ts

**File Path:** src/api/providers/anthropic.ts

**Main Function:** Provides functionality for interacting with the Anthropic LLM provider.

**Exported Classes:**
- `AnthropicHandler`: Handles API requests to Anthropic.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to Anthropic.
- `getModel()`: Returns the currently selected Anthropic model.


## src/api/providers/bedrock.ts

**File Path:** src/api/providers/bedrock.ts

**Main Function:** Provides functionality for interacting with the Bedrock LLM provider.

**Exported Classes:**
- `AwsBedrockHandler`: Handles API requests to Bedrock.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to Bedrock.
- `getModel()`: Returns the currently selected Bedrock model.


## src/api/providers/gemini.ts

**File Path:** src/api/providers/gemini.ts

**Main Function:** Provides functionality for interacting with the Gemini LLM provider.

**Exported Classes:**
- `GeminiHandler`: Handles API requests to Gemini.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to Gemini.
- `getModel()`: Returns the currently selected Gemini model.


## src/api/providers/ollama.ts

**File Path:** src/api/providers/ollama.ts

**Main Function:** Provides functionality for interacting with the Ollama LLM provider.

**Exported Classes:**
- `OllamaHandler`: Handles API requests to Ollama.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to Ollama.
- `getModel()`: Returns the currently selected Ollama model.


## src/api/providers/openai-native.ts

**File Path:** src/api/providers/openai-native.ts

**Main Function:** Provides functionality for interacting with the OpenAI Native LLM provider.

**Exported Classes:**
- `OpenAiNativeHandler`: Handles API requests to OpenAI Native.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to OpenAI Native.
- `getModel()`: Returns the currently selected OpenAI Native model.


## src/api/providers/openai.ts

**File Path:** src/api/providers/openai.ts

**Main Function:** Provides functionality for interacting with the OpenAI LLM provider.

**Exported Classes:**
- `OpenAiHandler`: Handles API requests to OpenAI.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to OpenAI.
- `getModel()`: Returns the currently selected OpenAI model.


## src/api/providers/openrouter.ts

**File Path:** src/api/providers/openrouter.ts

**Main Function:** Provides functionality for interacting with the OpenRouter LLM provider.

**Exported Classes:**
- `OpenRouterHandler`: Handles API requests to OpenRouter.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to OpenRouter.
- `getModel()`: Returns the currently selected OpenRouter model.


## src/api/providers/vertex.ts

**File Path:** src/api/providers/vertex.ts

**Main Function:** Provides functionality for interacting with the Vertex LLM provider.

**Exported Classes:**
- `VertexHandler`: Handles API requests to Vertex.

**Exported Methods:**
- `createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[])`: Creates a new message to send to Vertex.
- `getModel()`: Returns the currently selected Vertex model.


## src/api/transform/gemini-format.ts

**File Path:** src/api/transform/gemini-format.ts

**Main Function:** Provides functionality to convert between Anthropic and Gemini message formats.

**Exported Functions:**
- `convertAnthropicContentToGemini()`: Converts Anthropic content to Gemini format.
- `convertAnthropicMessageToGemini()`: Converts an Anthropic message to Gemini format.
- `convertAnthropicToolToGemini()`: Converts an Anthropic tool to Gemini format.
- `unescapeGeminiContent()`: Unescapes Gemini content.
- `convertGeminiResponseToAnthropic()`: Converts a Gemini response to Anthropic format.


## src/api/transform/o1-format.ts

**File Path:** src/api/transform/o1-format.ts

**Main Function:** Provides functionality to convert between Anthropic and O1 message formats.

**Exported Functions:**
- `convertToO1Messages()`: Converts Anthropic messages to O1 format.
- `parseAIResponse()`: Parses an AI response in O1 format.
- `parseToolCalls()`: Parses tool calls from an O1 response.
- `parseToolCall()`: Parses a single tool call from an O1 response.
- `validateToolInput()`: Validates tool input in O1 format.
- `convertO1ResponseToAnthropicMessage()`: Converts an O1 response to an Anthropic message.


## src/api/transform/openai-format.ts

**File Path:** src/api/transform/openai-format.ts

**Main Function:** Provides functionality to convert between Anthropic and OpenAI message formats.

**Exported Functions:**
- `convertToOpenAiMessages()`: Converts Anthropic messages to OpenAI format.
- `convertToAnthropicMessage()`: Converts an OpenAI message to Anthropic format.


## src/api/transform/stream.ts

**File Path:** src/api/transform/stream.ts

**Main Function:** Provides functionality to handle streaming responses from LLM providers.


## src/core/Cline.ts

**File Path:** src/core/Cline.ts

**Main Function:** Core class for Cline, managing the conversation flow, API interactions, and extension logic.

**Exported Classes:**
- `Cline`: Core class for Cline.

**Exported Methods:**
- `ask()`: Sends a message to the LLM and handles the response.
- `handleWebviewAskResponse()`: Handles the response from the webview after asking a question.
- `say()`: Sends a message to the LLM and handles the response.
- `sayAndCreateMissingParamError()`: Handles missing parameters for a tool call.
- `startTask()`: Starts a new task.
- `resumeTaskFromHistory()`: Resumes a task from history.
- `initiateTaskLoop()`: Initiates the main task loop.
- `abortTask()`: Aborts the current task.
- `executeCommandTool()`: Executes a command tool.
- `attemptApiRequest()`: Attempts an API request.
- `presentAssistantMessage()`: Presents an assistant message.
- `recursivelyMakeClineRequests()`: Recursively makes Cline requests.
- `loadContext()`: Loads the context for the current task.
- `getEnvironmentDetails()`: Gets the environment details for the current task.


## src/core/assistant-message/index.ts

**File Path:** src/core/assistant-message/index.ts


## src/core/assistant-message/parse-assistant-message.ts

**File Path:** src/core/assistant-message/parse-assistant-message.ts

**Main Function:** Parses assistant messages from the LLM.

**Exported Functions:**
- `parseAssistantMessage(assistantMessage: string)`: Parses an assistant message.


## src/core/mentions/index.ts

**File Path:** src/core/mentions/index.ts

**Main Function:** Provides functionality for handling mentions in the conversation.

**Exported Functions:**
- `openMention(mention?: string)`: Opens a mention.
- `parseMentions(text: string, cwd: string, urlContentFetcher: UrlContentFetcher)`: Parses mentions from text.
- `getFileOrFolderContent(mentionPath: string, cwd: string)`: Gets the content of a file or folder.
- `getWorkspaceProblems(cwd: string)`: Gets the workspace problems.


## src/core/prompts/responses.ts

**File Path:** src/core/prompts/responses.ts


## src/core/prompts/system.ts

**File Path:** src/core/prompts/system.ts

**Main Function:** Provides functionality for managing system prompts.

**Exported Functions:**
- `addCustomInstructions(customInstructions: string)`: Adds custom instructions to the system prompt.


## src/core/sliding-window/index.ts

**File Path:** src/core/sliding-window/index.ts

**Main Function:** Provides functionality for managing the conversation history using a sliding window.

**Exported Functions:**
- `truncateHalfConversation()`: Truncates half of the conversation history.


## src/core/webview/ClineProvider.ts

**File Path:** src/core/webview/ClineProvider.ts

**Main Function:** Provides the webview for the Cline extension.

**Exported Classes:**
- `ClineProvider`: Provides the webview for the Cline extension.

**Exported Methods:**
- `dispose()`: Disposes of the webview.
- `getVisibleInstance()`: Gets the visible instance of the ClineProvider.
- `resolveWebviewView()`: Resolves the webview view.
- `initClineWithTask()`: Initializes Cline with a task.
- `initClineWithHistoryItem()`: Initializes Cline with a history item.
- `postMessageToWebview()`: Posts a message to the webview.
- `getHtmlContent()`: Gets the HTML content for the webview.
- `setWebviewMessageListener()`: Sets a listener for messages from the webview.
- `updateCustomInstructions()`: Updates the custom instructions.
- `getOllamaModels()`: Gets the Ollama models.
- `handleOpenRouterCallback()`: Handles the OpenRouter callback.
- `ensureCacheDirectoryExists()`: Ensures that the cache directory exists.
- `readOpenRouterModels()`: Reads the OpenRouter models.
- `refreshOpenRouterModels()`: Refreshes the OpenRouter models.
- `getTaskWithId()`: Gets the task with the given ID.
- `showTaskWithId()`: Shows the task with the given ID.
- `exportTaskWithId()`: Exports the task with the given ID.
- `deleteTaskWithId()`: Deletes the task with the given ID.
- `deleteTaskFromState()`: Deletes a task from the state.
- `postStateToWebview()`: Posts the state to the webview.
- `getStateToPostToWebview()`: Gets the state to post to the webview.
- `clearTask()`: Clears the current task.
- `getState()`: Gets the current state.
- `updateTaskHistory()`: Updates the task history.
- `updateGlobalState()`: Updates the global state.
- `getGlobalState()`: Gets the global state.
- `updateWorkspaceState()`: Updates the workspace state.
- `getWorkspaceState()`: Gets the workspace state.
- `storeSecret()`: Stores a secret.
- `getSecret()`: Gets a secret.
- `resetState()`: Resets the state.


## src/core/webview/getNonce.ts

**File Path:** src/core/webview/getNonce.ts

**Main Function:** Generates a nonce for the webview.

**Exported Functions:**
- `getNonce()`: Generates a nonce.


## src/core/webview/getUri.ts

**File Path:** src/core/webview/getUri.ts

**Main Function:** Gets the URI for a resource in the webview.

**Exported Functions:**
- `getUri(webview: Webview, extensionUri: Uri, pathList: string[])`: Gets the URI for a resource.


## src/exports/cline.d.ts

**File Path:** src/exports/cline.d.ts

**Main Function:** Defines the Cline API for the extension.

**Exported Functions:**
- `setCustomInstructions(value: string)`: Sets the custom instructions.
- `getCustomInstructions()`: Gets the custom instructions.
- `startNewTask(task?: string, images?: string[])`: Starts a new task.
- `sendMessage(message?: string, images?: string[])`: Sends a message.
- `pressPrimaryButton()`: Presses the primary button.
- `pressSecondaryButton()`: Presses the secondary button.


## src/exports/index.ts

**File Path:** src/exports/index.ts

**Main Function:** Exports the Cline API.

**Exported Functions:**
- `createClineAPI(outputChannel: vscode.OutputChannel, sidebarProvider: ClineProvider)`: Creates a Cline API instance.


## src/integrations/diagnostics/DiagnosticsMonitor.ts

**File Path:** src/integrations/diagnostics/DiagnosticsMonitor.ts


## src/integrations/diagnostics/index.ts

**File Path:** src/integrations/diagnostics/index.ts

**Main Function:** Provides functionality for managing diagnostics.

**Exported Functions:**
- `getNewDiagnostics()`: Gets the new diagnostics.
- `diagnosticsToProblemsString()`: Converts diagnostics to a string.


## src/integrations/editor/DecorationController.ts

**File Path:** src/integrations/editor/DecorationController.ts

**Main Function:** Provides functionality for managing decorations in the editor.

**Exported Classes:**
- `DecorationController`: Manages decorations in the editor.

**Exported Methods:**
- `getDecoration()`: Gets the decoration.
- `addLines(startIndex: number, numLines: number)`: Adds lines to the decoration.
- `clear()`: Clears the decoration.
- `updateOverlayAfterLine(line: number, totalLines: number)`: Updates the overlay after a line.
- `setActiveLine(line: number)`: Sets the active line.


## src/integrations/editor/detect-omission.ts

**File Path:** src/integrations/editor/detect-omission.ts

**Main Function:** Detects code omissions between two versions of a file.

**Exported Functions:**
- `detectCodeOmission(originalFileContent: string, newFileContent: string)`: Detects code omissions.
- `showOmissionWarning(originalFileContent: string, newFileContent: string)`: Shows a warning for code omissions.


## src/integrations/editor/DiffViewProvider.ts

**File Path:** src/integrations/editor/DiffViewProvider.ts

**Main Function:** Provides functionality for managing diff views.

**Exported Classes:**
- `DiffViewProvider`: Manages diff views.

**Exported Methods:**
- `open(relPath: string)`: Opens a diff view.
- `update(accumulatedContent: string, isFinal: boolean)`: Updates the diff view.
- `saveChanges()`: Saves changes in the diff view.
- `revertChanges()`: Reverts changes in the diff view.
- `closeAllDiffViews()`: Closes all diff views.
- `openDiffEditor()`: Opens a diff editor.
- `scrollEditorToLine(line: number)`: Scrolls the editor to a specific line.
- `scrollToFirstDiff()`: Scrolls to the first diff.
- `reset()`: Resets the diff view.


## src/integrations/misc/export-markdown.ts

**File Path:** src/integrations/misc/export-markdown.ts

**Main Function:** Provides functionality to export conversation history as a Markdown file. It handles formatting the conversation into a Markdown structure, prompting the user for a save location, and writing the content to the selected file.

**Exported Functions:**
- `downloadTask(dateTs: number, conversationHistory: Anthropic.MessageParam[])`: Exports the conversation history as a Markdown file.
- `formatContentBlockToMarkdown(block: Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam)`: Formats a content block into Markdown.
- `findToolName(toolCallId: string, messages: Anthropic.MessageParam[])`: Finds the name of a tool based on its ID.


## src/integrations/misc/extract-text.ts

**File Path:** src/integrations/misc/extract-text.ts

**Main Function:** Provides functionality to extract text from various file formats.

**Exported Functions:**
- `extractTextFromFile(filePath: string)`: Extracts text from a file.
- `extractTextFromPDF(filePath: string)`: Extracts text from a PDF file.
- `extractTextFromDOCX(filePath: string)`: Extracts text from a DOCX file.
- `extractTextFromIPYNB(filePath: string)`: Extracts text from an IPYNB file.


## src/integrations/misc/open-file.ts

**File Path:** src/integrations/misc/open-file.ts

**Main Function:** Provides functionality to open files and images.

**Exported Functions:**
- `openImage(dataUri: string)`: Opens an image.
- `openFile(absolutePath: string)`: Opens a file.


## src/integrations/misc/process-images.ts

**File Path:** src/integrations/misc/process-images.ts

**Main Function:** Provides functionality to process images.

**Exported Functions:**
- `selectImages()`: Selects images.
- `getMimeType(filePath: string)`: Gets the MIME type of a file.


## src/integrations/terminal/TerminalManager.ts

**File Path:** src/integrations/terminal/TerminalManager.ts

**Main Function:** Manages terminals for running commands.

**Exported Classes:**
- `TerminalManager`: Manages terminals.

**Exported Methods:**
- `runCommand(terminalInfo: TerminalInfo, command: string)`: Runs a command in a terminal.
- `getOrCreateTerminal(cwd: string)`: Gets or creates a terminal.
- `getTerminals(busy: boolean)`: Gets the terminals.
- `getUnretrievedOutput(terminalId: number)`: Gets the unretrieved output for a terminal.
- `isProcessHot(terminalId: number)`: Checks if a terminal process is hot.
- `disposeAll()`: Disposes of all terminals.


## src/integrations/terminal/TerminalProcess.ts

**File Path:** src/integrations/terminal/TerminalProcess.ts

**Main Function:** Represents a terminal process.

**Exported Classes:**
- `TerminalProcess`: Represents a terminal process.

**Exported Methods:**
- `run(terminal: vscode.Terminal, command: string)`: Runs a command in a terminal.
- `continue()`: Continues a terminal process.
- `getUnretrievedOutput()`: Gets the unretrieved output for a terminal process.
- `removeLastLineArtifacts(output: string)`: Removes last line artifacts from output.
- `mergePromise(process: TerminalProcess, promise: Promise<void>)`: Merges a promise with a terminal process.


## src/integrations/terminal/TerminalRegistry.ts

**File Path:** src/integrations/terminal/TerminalRegistry.ts

**Main Function:** Manages the registry of terminals.

**Exported Classes:**
- `TerminalRegistry`: Manages the registry of terminals.

**Exported Methods:**
- `createTerminal(cwd?: string | vscode.Uri | undefined)`: Creates a new terminal.
- `getTerminal(id: number)`: Gets a terminal by ID.
- `updateTerminal(id: number, updates: Partial<TerminalInfo>)`: Updates a terminal.
- `removeTerminal(id: number)`: Removes a terminal.
- `getAllTerminals()`: Gets all terminals.
- `isTerminalClosed(terminal: vscode.Terminal)`: Checks if a terminal is closed.


## src/integrations/theme/getTheme.ts

**File Path:** src/integrations/theme/getTheme.ts

**Main Function:** Provides functionality for managing themes.

**Exported Functions:**
- `parseThemeString(themeString: string | undefined)`: Parses a theme string.
- `getTheme()`: Gets the current theme.
- `mergeJson()`: Merges two JSON objects.
- `getExtensionUri()`: Gets the extension URI.


## src/integrations/workspace/WorkspaceTracker.ts

**File Path:** src/integrations/workspace/WorkspaceTracker.ts

**Main Function:** Tracks changes to the workspace.

**Exported Classes:**
- `WorkspaceTracker`: Tracks changes to the workspace.

**Exported Methods:**
- `initializeFilePaths()`: Initializes the file paths.
- `registerListeners()`: Registers listeners for workspace events.
- `onFilesCreated(event: vscode.FileCreateEvent)`: Handles file creation events.
- `onFilesDeleted(event: vscode.FileDeleteEvent)`: Handles file deletion events.
- `onFilesRenamed(event: vscode.FileRenameEvent)`: Handles file rename events.
- `workspaceDidUpdate()`: Handles workspace update events.
- `normalizeFilePath(filePath: string)`: Normalizes a file path.
- `addFilePath(filePath: string)`: Adds a file path.
- `removeFilePath(filePath: string)`: Removes a file path.
- `dispose()`: Disposes of the workspace tracker.


## src/integrations/workspace/get-python-env.ts

**File Path:** src/integrations/workspace/get-python-env.ts

**Main Function:** Gets the path to the Python environment.

**Exported Functions:**
- `getPythonEnvPath()`: Gets the path to the Python environment.


## src/services/browser/UrlContentFetcher.ts

**File Path:** src/services/browser/UrlContentFetcher.ts

**Main Function:** Provides functionality for fetching content from URLs.

**Exported Classes:**
- `UrlContentFetcher`: Fetches content from URLs.

**Exported Methods:**
- `constructor(context: vscode.ExtensionContext)`: Constructor for UrlContentFetcher.
- `ensureChromiumExists()`: Ensures that Chromium is installed.
- `launchBrowser()`: Launches the Chromium browser.
- `closeBrowser()`: Closes the Chromium browser.
- `urlToMarkdown(url: string)`: Converts a URL to Markdown.
- `urlToScreenshotAndLogs(url: string)`: Converts a URL to a screenshot and logs.
- `waitTillHTMLStable(page: Page, timeout = 5_000)`: Waits until the HTML content is stable.


## src/services/glob/list-files.ts

**File Path:** src/services/glob/list-files.ts

**Main Function:** Provides functionality for listing files in a directory.

**Exported Functions:**
- `listFiles(dirPath: string, recursive: boolean, limit: number)`: Lists files in a directory.
- `globbyLevelByLevel(limit: number, options?: Options)`: Globs files level by level.


## src/services/ripgrep/index.ts

**File Path:** src/services/ripgrep/index.ts

**Main Function:** Provides functionality for searching files using ripgrep.

**Exported Functions:**
- `getBinPath(vscodeAppRoot: string)`: Gets the path to the ripgrep binary.
- `pathExists(path: string)`: Checks if a path exists.
- `execRipgrep(bin: string, args: string[])`: Executes ripgrep.
- `regexSearchFiles()` : Searches files using ripgrep.
- `formatResults(results: SearchResult[], cwd: string)`: Formats the search results.


## src/services/tree-sitter/index.ts

**File Path:** src/services/tree-sitter/index.ts

**Main Function:** Provides functionality for parsing source code using tree-sitter.

**Exported Functions:**
- `parseSourceCodeForDefinitionsTopLevel(dirPath: string)`: Parses source code for top-level definitions.
- `separateFiles(allFiles: string[])`: Separates files into those to parse and those to ignore.
- `parseFile(filePath: string, languageParsers: LanguageParser)`: Parses a file.


## src/services/tree-sitter/languageParser.ts

**File Path:** src/services/tree-sitter/languageParser.ts

**Main Function:** Provides functionality for loading and managing tree-sitter language parsers.

**Exported Functions:**
- `loadLanguage(langName: string)`: Loads a language parser.
- `initializeParser()`: Initializes the parser.
- `loadRequiredLanguageParsers(filesToParse: string[])`: Loads the required language parsers.


## src/services/tree-sitter/queries/index.ts

**File Path:** src/services/tree-sitter/queries/index.ts


## src/shared/api.ts

**File Path:** src/shared/api.ts


## src/shared/array.ts

**File Path:** src/shared/array.ts

**Main Function:** Provides utility functions for working with arrays.

**Exported Functions:**
- `findLastIndex<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean)`: Finds the last index of an element in an array that satisfies a given predicate.
- `findLast<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean)`: Finds the last element in an array that satisfies a given predicate.


## src/shared/combineApiRequests.ts

**File Path:** src/shared/combineApiRequests.ts

**Main Function:** Combines API requests into a single request.

**Exported Functions:**
- `combineApiRequests(messages: ClineMessage[])`: Combines API requests.


## src/shared/combineCommandSequences.ts

**File Path:** src/shared/combineCommandSequences.ts

**Main Function:** Combines command sequences into a single sequence.

**Exported Functions:**
- `combineCommandSequences(messages: ClineMessage[])`: Combines command sequences.


## src/shared/context-mentions.ts

**File Path:** src/shared/context-mentions.ts


## src/shared/ExtensionMessage.ts

**File Path:** src/shared/ExtensionMessage.ts


## src/shared/getApiMetrics.ts

**File Path:** src/shared/getApiMetrics.ts

**Main Function:** Gets API metrics from a list of messages.

**Exported Functions:**
- `getApiMetrics(messages: ClineMessage[])`: Gets API metrics.


## src/shared/HistoryItem.ts

**File Path:** src/shared/HistoryItem.ts


## src/shared/WebviewMessage.ts

**File Path:** src/shared/WebviewMessage.ts


## src/test/extension.test.ts

**File Path:** src/test/extension.test.ts


## src/utils/cost.ts

**File Path:** src/utils/cost.ts

**Main Function:** Provides functionality for calculating API costs.

**Exported Functions:**
- `calculateApiCost()` : Calculates API costs.


## src/utils/fs.ts

**File Path:** src/utils/fs.ts

**Main Function:** Provides utility functions for working with the file system.

**Exported Functions:**
- `createDirectoriesForFile(filePath: string)`: Creates directories for a file.
- `fileExistsAtPath(filePath: string)`: Checks if a file exists at a path.


## src/utils/path.ts

**File Path:** src/utils/path.ts

**Main Function:** Provides utility functions for working with paths.

**Exported Functions:**
- `toPosixPath(p: string)`: Converts a path to POSIX format.
- `toPosix()` : Converts a path to POSIX format.
- `arePathsEqual(path1?: string, path2?: string)`: Checks if two paths are equal.
- `normalizePath(p: string)`: Normalizes a path.
- `getReadablePath(cwd: string, relPath?: string)`: Gets a readable path.


## webview-ui/src/App.tsx

**File Path:** webview-ui/src/App.tsx


## webview-ui/src/index.css

**File Path:** webview-ui/src/index.css


## webview-ui/src/index.tsx

**File Path:** webview-ui/src/index.tsx


## webview-ui/src/react-app-env.d.ts

**File Path:** webview-ui/src/react-app-env.d.ts


## webview-ui/src/reportWebVitals.ts

**File Path:** webview-ui/src/reportWebVitals.ts


## webview-ui/src/setupTests.ts

**File Path:** webview-ui/src/setupTests.ts


## webview-ui/src/components/chat/Announcement.tsx

**File Path:** webview-ui/src/components/chat/Announcement.tsx


## webview-ui/src/components/chat/ChatRow.tsx

**File Path:** webview-ui/src/components/chat/ChatRow.tsx


## webview-ui/src/components/chat/ChatTextArea.tsx

**File Path:** webview-ui/src/components/chat/ChatTextArea.tsx


## webview-ui/src/components/chat/ChatView.tsx

**File Path:** webview-ui/src/components/chat/ChatView.tsx


## webview-ui/src/components/chat/ContextMenu.tsx

**File Path:** webview-ui/src/components/chat/ContextMenu.tsx


## webview-ui/src/components/chat/TaskHeader.tsx

**File Path:** webview-ui/src/components/chat/TaskHeader.tsx


## webview-ui/src/components/common/CodeAccordian.tsx

**File Path:** webview-ui/src/components/common/CodeAccordian.tsx


## webview-ui/src/components/common/CodeBlock.tsx

**File Path:** webview-ui/src/components/common/CodeBlock.tsx


## webview-ui/src/components/common/Demo.tsx

**File Path:** webview-ui/src/components/common/Demo.tsx

**Main Function:** Provides a demo component.

**Exported Functions:**
- `Demo()`: Renders the demo component.


## webview-ui/src/components/common/MarkdownBlock.tsx

**File Path:** webview-ui/src/components/common/MarkdownBlock.tsx


## webview-ui/src/components/common/Thumbnails.tsx

**File Path:** webview-ui/src/components/common/Thumbnails.tsx


## webview-ui/src/components/common/VSCodeButtonLink.tsx

**File Path:** webview-ui/src/components/common/VSCodeButtonLink.tsx


## webview-ui/src/components/history/HistoryPreview.tsx

**File Path:** webview-ui/src/components/history/HistoryPreview.tsx


## webview-ui/src/components/history/HistoryView.tsx

**File Path:** webview-ui/src/components/history/HistoryView.tsx


## webview-ui/src/components/settings/ApiOptions.tsx

**File Path:** webview-ui/src/components/settings/ApiOptions.tsx

**Main Function:** Provides options for configuring API settings.

**Exported Functions:**
- `getOpenRouterAuthUrl(uriScheme?: string)`: Gets the OpenRouter authentication URL.
- `normalizeApiConfiguration(apiConfiguration?: ApiConfiguration)`: Normalizes the API configuration.


## webview-ui/src/components/settings/OpenRouterModelPicker.tsx

**File Path:** webview-ui/src/components/settings/OpenRouterModelPicker.tsx


## webview-ui/src/components/settings/SettingsView.tsx

**File Path:** webview-ui/src/components/settings/SettingsView.tsx


## webview-ui/src/components/settings/TabNavbar.tsx

**File Path:** webview-ui/src/components/settings/TabNavbar.tsx


## webview-ui/src/components/welcome/WelcomeView.tsx

**File Path:** webview-ui/src/components/welcome/WelcomeView.tsx


## webview-ui/src/context/ExtensionStateContext.tsx

**File Path:** webview-ui/src/context/ExtensionStateContext.tsx


## webview-ui/src/utils/context-mentions.ts

**File Path:** webview-ui/src/utils/context-mentions.ts

**Main Function:** Provides utility functions for handling context mentions.

**Exported Functions:**
- `insertMention()` : Inserts a mention.
- `removeMention(text: string, position: number)`: Removes a mention.
- `getContextMenuOptions()` : Gets the context menu options.
- `shouldShowContextMenu(text: string, position: number)`: Checks if the context menu should be shown.


## webview-ui/src/utils/format.ts

**File Path:** webview-ui/src/utils/format.ts

**Main Function:** Provides utility functions for formatting data.

**Exported Functions:**
- `formatLargeNumber(num: number)`: Formats a large number.


## webview-ui/src/utils/getLanguageFromPath.ts

**File Path:** webview-ui/src/utils/getLanguageFromPath.ts

**Main Function:** Gets the language from a file path.

**Exported Functions:**
- `getLanguageFromPath(path: string)`: Gets the language from a file path.


## webview-ui/src/utils/textMateToHljs.ts

**File Path:** webview-ui/src/utils/textMateToHljs.ts

**Main Function:** Converts TextMate themes to Highlight.js themes.

**Exported Functions:**
- `convertTextMateToHljs(fullColorTheme: any)`: Converts a TextMate theme to a Highlight.js theme.
- `constructTheme(tmTheme: FullColorTheme)`: Constructs a theme.
- `fallbackTheme()` : Falls back to a default theme.
- `parseHexColor(hexColor: string)`: Parses a hex color.


## webview-ui/src/utils/validate.ts

**File Path:** webview-ui/src/utils/validate.ts

**Main Function:** Provides utility functions for validation.

**Exported Functions:**
- `validateApiKey(apiKey: string)`: Validates an API key.
- `validateUrl(url: string)`: Validates a URL.


## webview-ui/src/utils/vscode.ts

**File Path:** webview-ui/src/utils/vscode.ts

**Main Function:** Provides utility functions for interacting with VS Code's webview API.

**Exported Functions:**
- `getVsCodeApi()`: Gets the VS Code API for use in the webview.
