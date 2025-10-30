# Cline Telemetry Events Reference

This document outlines all unique telemetry events captured by the Cline extension's TelemetryService.

## Table of Contents

1. [User Events](#user-events)
2. [Dictation Events](#dictation-events)
3. [Task Events](#task-events)
4. [UI Events](#ui-events)
5. [Workspace Events](#workspace-events)

---

## User Events

### `user.opt_out`
Records when a user opts out of telemetry.

### `user.telemetry_enabled`
Records when telemetry is enabled for the user.

### `user.extension_activated`
Tracks when the Cline extension is activated in the IDE.

### `user.auth_started`
Records when authentication flow is started.

**Properties:**
- `provider` (string): The authentication provider being used

### `user.auth_succeeded`
Records when authentication flow succeeds.

**Properties:**
- `provider` (string): The authentication provider that was used

### `user.auth_failed`
Records when authentication flow fails.

**Properties:**
- `provider` (string): The authentication provider that was used

### `user.auth_logged_out`
Records when user logs out of their account.

**Properties:**
- `provider` (string): The authentication provider that was used
- `reason` (string): The reason for logout (user action, cross-window sync, error, etc.)

---

## Dictation Events

### `voice.recording_started`
Records when voice recording is started.

**Properties:**
- `taskId` (string): Optional task identifier if recording was started during a task
- `platform` (string): The platform where recording is happening (macOS, Windows, Linux)
- `timestamp` (string): ISO timestamp

### `voice.recording_stopped`
Records when voice recording is stopped.

**Properties:**
- `taskId` (string): Optional task identifier
- `durationMs` (number): Duration of the recording in milliseconds
- `success` (boolean): Whether the recording was successful
- `platform` (string): The platform where recording happened
- `timestamp` (string): ISO timestamp

### `voice.transcription_started`
Records when voice transcription is started.

**Properties:**
- `taskId` (string): Optional task identifier
- `language` (string): Language hint provided for transcription
- `timestamp` (string): ISO timestamp

### `voice.transcription_completed`
Records when voice transcription is completed successfully.

**Properties:**
- `taskId` (string): Optional task identifier
- `transcriptionLength` (number): Length of the transcribed text
- `durationMs` (number): Time taken for transcription in milliseconds
- `language` (string): Language used for transcription
- `accountType` (string): "organization" or "personal"
- `timestamp` (string): ISO timestamp

### `voice.transcription_error`
Records when voice transcription fails.

**Properties:**
- `taskId` (string): Optional task identifier
- `errorType` (string): Type of error (e.g., "no_openai_key", "api_error", "network_error")
- `errorMessage` (string): The error message
- `durationMs` (number): Time taken before failure in milliseconds
- `timestamp` (string): ISO timestamp

---

## Task Events

### `task.created`
Tracks when a new task/conversation is started.

**Properties:**
- `ulid` (string): Unique identifier for the new task
- `apiProvider` (string): Optional API provider

### `task.restarted`
Tracks when a task/conversation is restarted.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `apiProvider` (string): Optional API provider

### `task.completed`
Records when Cline calls the task completion_result tool signifying that Cline is done with the task.

**Properties:**
- `ulid` (string): Unique identifier for the task

### `task.feedback`
Tracks user feedback on completed tasks.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `feedbackType` (string): "thumbs_up" or "thumbs_down"

### `task.conversation_turn`
Captures that a message was sent, including the API provider and model used.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `provider` (string): The API provider (e.g., OpenAI, Anthropic)
- `model` (string): The specific model used (e.g., GPT-4, Claude)
- `source` (string): "user" or "assistant"
- `timestamp` (string): ISO timestamp
- `tokensIn` (number): Number of input tokens consumed
- `tokensOut` (number): Number of output tokens generated
- `cacheWriteTokens` (number): Cache write tokens
- `cacheReadTokens` (number): Cache read tokens
- `totalCost` (number): Total cost of the request

### `task.tokens`
Records token usage metrics for cost tracking and usage analysis.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `tokensIn` (number): Number of input tokens consumed
- `tokensOut` (number): Number of output tokens generated
- `model` (string): The model used for token calculation

### `task.mode`
Records when a task switches between plan and act modes.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `mode` (string): The mode being switched to (plan or act)

### `task.option_selected`
Tracks when users select an option from AI-generated followup questions.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `qty` (number): The quantity of options that were presented
- `mode` (string): The mode in which the option was selected

### `task.options_ignored`
Tracks when users type a custom response instead of selecting an option from AI-generated followup questions.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `qty` (number): The quantity of options that were presented
- `mode` (string): The mode in which the custom response was provided

### `task.checkpoint_used`
Tracks usage of the git-based checkpoint system.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `action` (string): "shadow_git_initialized", "commit_created", "restored", or "diff_generated"
- `durationMs` (number): Optional duration of the operation in milliseconds

### `task.tool_used`
Records when a tool is used during task execution.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `tool` (string): Name of the tool being used
- `modelId` (string): The model ID being used
- `autoApproved` (boolean): Whether the tool was auto-approved
- `success` (boolean): Whether the tool execution was successful
- Workspace context properties (when applicable):
  - `workspace_multi_root_enabled` (boolean)
  - `workspace_hint_used` (boolean)
  - `workspace_resolved_non_primary` (boolean)
  - `workspace_resolution_method` (string): "hint", "primary_fallback", or "path_detection"

### `task.mcp_tool_called`
Records when an MCP tool is called.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `serverName` (string): The name of the MCP server
- `toolName` (string): The name of the tool being called
- `status` (string): "started", "success", or "error"
- `errorMessage` (string): Optional error message if the call failed
- `argumentKeys` (array): Optional array of argument keys for the tool

### `task.historical_loaded`
Tracks when a historical task is loaded from storage.

### `task.retry_clicked`
Tracks when the retry button is clicked for failed operations.

### `task.diff_edit_failed`
Records when a diff edit (replace_in_file) operation fails.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `modelId` (string): The model ID being used
- `errorType` (string): Type of error (e.g., "search_not_found", "invalid_format")

### `task.browser_tool_start`
Tracks when the browser tool is started.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `viewport` (object): The browser viewport settings
- `isRemote` (boolean): Whether remote browser is enabled
- `remoteBrowserHost` (string): Remote browser host if applicable
- `timestamp` (string): ISO timestamp

### `task.browser_tool_end`
Tracks when the browser tool is completed.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `actionCount` (number): Number of actions performed
- `duration` (number): Duration of the browser session
- `actions` (array): List of actions performed
- `timestamp` (string): ISO timestamp

### `task.browser_error`
Tracks when browser errors occur.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `errorType` (string): Type of error (e.g., "launch_error", "connection_error", "navigation_error")
- `errorMessage` (string): The error message
- `context` (object): Additional context
  - `action` (string)
  - `url` (string)
  - `isRemote` (boolean)
  - `remoteBrowserHost` (string)
  - `endpoint` (string)
- `timestamp` (string): ISO timestamp

### `task.gemini_api_performance`
Tracks Gemini API specific performance metrics.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `modelId` (string): Specific Gemini model ID
- `ttftSec` (number): Time to first token in seconds
- `totalDurationSec` (number): Total duration in seconds
- `promptTokens` (number): Number of prompt tokens
- `outputTokens` (number): Number of output tokens
- `cacheReadTokens` (number): Number of cache read tokens
- `cacheHit` (boolean): Whether cache was hit
- `cacheHitPercentage` (number): Cache hit percentage
- `apiSuccess` (boolean): Whether API call succeeded
- `apiError` (string): API error if applicable
- `throughputTokensPerSec` (number): Throughput in tokens per second

### `task.provider_api_error`
Tracks when API providers return errors.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `model` (string): Identifier of the model used
- `errorMessage` (string): Detailed error message (truncated to 500 chars)
- `provider` (string): Provider name
- `errorStatus` (number): HTTP status code of the error response
- `requestId` (string): Unique identifier for the specific API request
- `timestamp` (string): ISO timestamp

### `task.focus_chain_enabled`
Tracks when users enable the focus chain feature.

**Properties:**
- `enabled` (boolean): true

### `task.focus_chain_disabled`
Tracks when users disable the focus chain feature.

**Properties:**
- `enabled` (boolean): false

### `task.focus_chain_progress_first`
Tracks when the first focus chain return is returned by the model.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `totalItems` (number): Number of items in the initial focus chain list

### `task.focus_chain_progress_update`
Tracks when subsequent focus chain list returns are returned.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `totalItems` (number): Total number of items in the focus chain list
- `completedItems` (number): Number of completed items
- `completionPercentage` (number): Completion percentage (0-100)

### `task.focus_chain_incomplete_on_completion`
Tracks the status of the focus chain list when the task reaches a task completion state.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `totalItems` (number): Total number of items
- `completedItems` (number): Number of completed items
- `incompleteItems` (number): Number of incomplete items
- `completionPercentage` (number): Completion percentage (0-100)

### `task.focus_chain_list_opened`
Tracks when users click to open the focus chain markdown file.

**Properties:**
- `ulid` (string): Unique identifier for the task

### `task.focus_chain_list_written`
Tracks when users save and write to the focus chain markdown file.

**Properties:**
- `ulid` (string): Unique identifier for the task

### `task.summarize_task`
Tracks when the context window is auto-condensed with the summarize_task tool call.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `modelId` (string): The model that triggered summarization
- `currentTokens` (number): Total tokens in context window when summarization was triggered
- `maxContextWindow` (number): Maximum context window size for the model

### `task.slash_command_used`
Tracks when slash commands or workflows are activated.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `commandName` (string): The name of the command (e.g., "newtask", "reportbug", or custom workflow name)
- `commandType` (string): "builtin" or "workflow"

### `task.rule_toggled`
Tracks when individual Cline rules are toggled on/off.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `ruleFileName` (string): The filename of the rule (sanitized to exclude full path)
- `enabled` (boolean): Whether the rule is being enabled or disabled
- `isGlobal` (boolean): Whether this is a global rule or workspace-specific rule

### `task.auto_condense_toggled`
Tracks when auto condense setting is toggled on/off.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `enabled` (boolean): Whether auto condense was enabled or disabled
- `modelId` (string): The model ID being used when the toggle occurred

### `task.yolo_mode_toggled`
Tracks when yolo mode setting is toggled on/off.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `enabled` (boolean): Whether yolo mode was enabled or disabled

### `task.initialization`
Records task initialization timing and metadata.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `taskId` (string): Task ID (timestamp in milliseconds when task was created)
- `durationMs` (number): Duration of initialization in milliseconds
- `hasCheckpoints` (boolean): Whether checkpoints are enabled for this task

### `task.terminal_execution`
Records terminal command execution outcomes.

**Properties:**
- `success` (boolean): Whether the command output was successfully captured
- `method` (string): "shell_integration", "clipboard", or "none"

### `task.terminal_output_failure`
Records when terminal output capture fails.

**Properties:**
- `reason` (string): "timeout", "no_shell_integration", or "clipboard_failed"

### `task.terminal_user_intervention`
Records when user has to intervene with terminal execution.

**Properties:**
- `action` (string): "process_while_running", "manual_paste", or "cancelled"

### `task.terminal_hang`
Records when terminal execution hangs or gets stuck.

**Properties:**
- `stage` (string): "waiting_for_completion", "buffer_stuck", or "stream_timeout"

### `task.mention_used`
Records when a mention is successfully used and content is retrieved.

**Properties:**
- `mentionType` (string): "file", "folder", "url", "problems", "terminal", "git-changes", or "commit"
- `contentLength` (number): Optional length of content retrieved
- `timestamp` (string): ISO timestamp

### `task.mention_failed`
Records when a mention fails to retrieve content.

**Properties:**
- `mentionType` (string): "file", "folder", "url", "problems", "terminal", "git-changes", or "commit"
- `errorType` (string): "not_found", "permission_denied", "network_error", "parse_error", or "unknown"
- `errorMessage` (string): Optional error message (truncated to 500 chars)
- `timestamp` (string): ISO timestamp

### `task.mention_search_results`
Records search results when user searches for files/folders in mention dropdown.

**Properties:**
- `queryLength` (number): Length of the search query
- `resultCount` (number): Number of results returned
- `searchType` (string): "file", "folder", or "all"
- `isEmpty` (boolean): Whether the search returned no results
- `timestamp` (string): ISO timestamp

### `task.workspace_search_pattern`
Records multi-workspace search patterns and performance.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `search_type` (string): "targeted", "cross_workspace", or "primary_only"
- `workspace_count` (number): Number of workspaces searched
- `hint_provided` (boolean): Whether a workspace hint was provided
- `results_found` (boolean): Whether search results were found
- `search_duration_ms` (number): Optional search duration in milliseconds

### `task.subagent_enabled`
Records when CLI subagents feature is enabled by the user.

**Properties:**
- `enabled` (boolean): true
- `timestamp` (string): ISO timestamp

### `task.subagent_disabled`
Records when CLI subagents feature is disabled by the user.

**Properties:**
- `enabled` (boolean): false
- `timestamp` (string): ISO timestamp

### `task.subagent_started`
Records when a CLI subagent execution begins (tracked via captureSubagentExecution with success=false).

**Properties:**
- `ulid` (string): Unique identifier for the task
- `durationMs` (number): Duration of the subagent execution
- `outputLines` (number): Number of lines of output produced
- `success` (boolean): false
- `timestamp` (string): ISO timestamp

### `task.subagent_completed`
Records when a CLI subagent execution completes (tracked via captureSubagentExecution with success=true).

**Properties:**
- `ulid` (string): Unique identifier for the task
- `durationMs` (number): Duration of the subagent execution
- `outputLines` (number): Number of lines of output produced
- `success` (boolean): true
- `timestamp` (string): ISO timestamp

---

## UI Events

### `ui.model_selected`
Records when a different model is selected for use.

**Properties:**
- `model` (string): Name of the selected model
- `provider` (string): Provider of the selected model
- `ulid` (string): Optional task identifier if model was selected during a task

### `ui.model_favorite_toggled`
Records when the user uses the model favorite button in the model picker.

**Properties:**
- `model` (string): The name of the model the user has interacted with
- `isFavorited` (boolean): Whether the model is being favorited (true) or unfavorited (false)

### `ui.button_clicked`
Tracks when a button is clicked.

**Properties:**
- `button` (string): The button identifier
- `ulid` (string): Optional task identifier

### `ui.rules_menu_opened`
Tracks when the rules menu button is clicked to open the rules/workflows modal.

**Properties:** None

---

## Workspace Events

### `workspace.initialized`
Records when workspace is initialized.

**Properties:**
- `root_count` (number): Number of workspace roots
- `vcs_types` (array): Array of VCS types detected
- `is_multi_root` (boolean): Whether there are multiple roots
- `has_git` (boolean): Whether Git is detected
- `has_mercurial` (boolean): Whether Mercurial is detected
- `init_duration_ms` (number): Time taken to initialize in milliseconds
- `feature_flag_enabled` (boolean): Whether multi-root feature flag is enabled

### `workspace.init_error`
Records workspace initialization errors.

**Properties:**
- `error_type` (string): The error constructor name
- `error_message` (string): Error message (truncated to 500 chars)
- `fallback_to_single_root` (boolean): Whether system fell back to single-root mode
- `workspace_count` (number): Number of workspace folders detected

### `workspace.vcs_detected`
Tracks VCS detection in workspace.

### `workspace.multi_root_checkpoint`
Records multi-root checkpoint operations.

**Properties:**
- `ulid` (string): Task identifier
- `action` (string): "initialized", "committed", or "restored"
- `root_count` (number): Number of roots being checkpointed
- `success_count` (number): Number of successful checkpoints
- `failure_count` (number): Number of failed checkpoints
- `success_rate` (number): Success rate (0-1)
- `duration_ms` (number): Total operation duration in milliseconds

### `workspace.path_resolved`
Records workspace path resolution events.

**Properties:**
- `ulid` (string): Unique identifier for the task
- `context` (string): The component/handler where resolution occurred
- `resolution_type` (string): "hint_provided", "fallback_to_primary", or "cross_workspace_search"
- `hint_type` (string): "workspace_name", "workspace_path", or "invalid"
- `resolution_success` (boolean): Whether the resolution was successful
- `target_workspace_index` (number): Index of the resolved workspace (0=primary, 1=secondary, etc.)
- `is_multi_root_enabled` (boolean): Whether multi-root mode is enabled

---

## Telemetry Categories

The TelemetryService supports categorized telemetry that can be individually enabled or disabled:

- **checkpoints**: Git-based checkpoint system events
- **browser**: Browser tool usage and errors
- **focus_chain**: Focus chain/task progress tracking events
- **dictation**: Voice recording and transcription events
- **subagents**: CLI subagents feature events

---

## Metadata

All telemetry events include the following metadata properties:

- `extension_version` (string): The extension or cline-core version
- `platform` (string): The name of the host IDE (e.g., VSCode)
- `platform_version` (string): The version of the host environment
- `os_type` (string): The operating system type (e.g., darwin, win32)
- `os_version` (string): The operating system version
- `is_dev` (string): Whether the extension is running in development mode

---

## Privacy & Configuration

- Maximum error message length is truncated to 500 characters
- Telemetry respects user privacy settings and VSCode's global telemetry configuration
- Telemetry is only enabled when both VSCode global telemetry is enabled AND user has opted in
- Some events bypass opt-out settings (marked as "required" events)
