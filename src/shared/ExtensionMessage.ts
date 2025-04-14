// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or 'settingsButtonClicked' or 'hello'

import { PostHogUsage } from '../analysis/codeAnalyzer'
import { GitCommit } from '../utils/git'
import { ApiConfiguration, ModelInfo } from './api'
import { AutoApprovalSettings } from './AutoApprovalSettings'
import { BrowserSettings } from './BrowserSettings'
import { ChatSettings } from './ChatSettings'
import { HistoryItem } from './HistoryItem'
import { McpServer } from './mcp'
import { TelemetrySetting } from './TelemetrySetting'

// webview will hold state
export interface ExtensionMessage {
    type:
        | 'action'
        | 'state'
        | 'selectedImages'
        | 'theme'
        | 'workspaceUpdated'
        | 'invoke'
        | 'partialMessage'
        | 'mcpServers'
        | 'relinquishControl'
        | 'authCallback'
        | 'commitSearchResults'
        | 'openGraphData'
        | 'isImageUrlResult'
        | 'didUpdateSettings'
        | 'totalTasksSize'
        | 'addToInput'
        | 'usageUpdated'
    text?: string
    action?:
        | 'chatButtonClicked'
        | 'mcpButtonClicked'
        | 'settingsButtonClicked'
        | 'historyButtonClicked'
        | 'analysisButtonClicked'
        | 'didBecomeVisible'
    invoke?: Invoke
    state?: ExtensionState
    images?: string[]
    filePaths?: string[]
    partialMessage?: PostHogMessage
    mcpServers?: McpServer[]
    customToken?: string
    error?: string
    commits?: GitCommit[]
    openGraphData?: {
        title?: string
        description?: string
        image?: string
        url?: string
        siteName?: string
        type?: string
    }
    url?: string
    isImage?: boolean
    totalTasksSize?: number | null
    usage?: PostHogUsage[]
}

export type Invoke = 'sendMessage' | 'primaryButtonClick' | 'secondaryButtonClick'

export type Platform = 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'unknown'

export const DEFAULT_PLATFORM = 'unknown'

export interface ExtensionState {
    apiConfiguration?: ApiConfiguration
    autoApprovalSettings: AutoApprovalSettings
    browserSettings: BrowserSettings
    chatSettings: ChatSettings
    checkpointTrackerErrorMessage?: string
    posthogMessages: PostHogMessage[]
    currentTaskItem?: HistoryItem
    customInstructions?: string
    planActSeparateModelsSetting: boolean
    platform: Platform
    taskHistory: HistoryItem[]
    telemetrySetting: TelemetrySetting
    uriScheme?: string
    userInfo?: {
        displayName: string | null
        email: string | null
        photoURL: string | null
    }
    version: string
    vscMachineId: string
    enableTabAutocomplete: boolean
}

export interface PostHogMessage {
    ts: number
    type: 'ask' | 'say'
    ask?: PostHogAsk
    say?: PostHogSay
    text?: string
    reasoning?: string
    images?: string[]
    partial?: boolean
    lastCheckpointHash?: string
    isCheckpointCheckedOut?: boolean
    conversationHistoryIndex?: number
    conversationHistoryDeletedRange?: [number, number] // for when conversation history is truncated for API requests
}

export type PostHogAsk =
    | 'followup'
    | 'plan_mode_respond'
    | 'command'
    | 'command_output'
    | 'completion_result'
    | 'tool'
    | 'api_req_failed'
    | 'resume_task'
    | 'resume_completed_task'
    | 'mistake_limit_reached'
    | 'auto_approval_max_req_reached'
    | 'browser_action_launch'
    | 'use_mcp_server'

export type PostHogSay =
    | 'task'
    | 'error'
    | 'api_req_started'
    | 'api_req_finished'
    | 'text'
    | 'reasoning'
    | 'completion_result'
    | 'user_feedback'
    | 'user_feedback_diff'
    | 'api_req_retried'
    | 'command'
    | 'command_output'
    | 'tool'
    | 'shell_integration_warning'
    | 'browser_action_launch'
    | 'browser_action'
    | 'browser_action_result'
    | 'mcp_server_request_started'
    | 'mcp_server_response'
    | 'use_mcp_server'
    | 'diff_error'
    | 'deleted_api_reqs'
    | 'posthogignore_error'
    | 'checkpoint_created'

export interface PostHogSayTool {
    tool: string
    path?: string
    diff?: string
    content?: string
    regex?: string
    filePattern?: string
}

// must keep in sync with system prompt
export const browserActions = ['launch', 'click', 'type', 'scroll_down', 'scroll_up', 'close'] as const
export type BrowserAction = (typeof browserActions)[number]

export interface PostHogSayBrowserAction {
    action: BrowserAction
    coordinate?: string
    text?: string
}

export type BrowserActionResult = {
    screenshot?: string
    logs?: string
    currentUrl?: string
    currentMousePosition?: string
}

export interface PostHogAskUseMcpServer {
    serverName: string
    type: 'use_mcp_tool' | 'access_mcp_resource'
    toolName?: string
    arguments?: string
    uri?: string
}

export interface PostHogPlanModeResponse {
    response: string
    options?: string[]
    selected?: string
}

export interface PostHogAskQuestion {
    question: string
    options?: string[]
    selected?: string
}

export interface PostHogApiReqInfo {
    request?: string
    tokensIn?: number
    tokensOut?: number
    cacheWrites?: number
    cacheReads?: number
    success?: boolean
    cancelReason?: PostHogApiReqCancelReason
    streamingFailedMessage?: string
}

export type PostHogApiReqCancelReason = 'streaming_failed' | 'user_cancelled'

export const COMPLETION_RESULT_CHANGES_FLAG = 'HAS_CHANGES'
