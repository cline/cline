package types

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/beadsmith/grpc-go/beadsmith"
)

// BeadsmithMessage represents a conversation message in the CLI
type BeadsmithMessage struct {
	Type                        MessageType `json:"type"`
	Text                        string      `json:"text"`
	Timestamp                   int64       `json:"ts"`
	Reasoning                   string      `json:"reasoning,omitempty"`
	Say                         string      `json:"say,omitempty"`
	Ask                         string      `json:"ask,omitempty"`
	Partial                     bool        `json:"partial,omitempty"`
	Images                      []string    `json:"images,omitempty"`
	Files                       []string    `json:"files,omitempty"`
	LastCheckpointHash          string      `json:"lastCheckpointHash,omitempty"`
	IsCheckpointCheckedOut      bool        `json:"isCheckpointCheckedOut,omitempty"`
	IsOperationOutsideWorkspace bool        `json:"isOperationOutsideWorkspace,omitempty"`
}

// MessageType represents the type of message
type MessageType string

const (
	MessageTypeAsk MessageType = "ask"
	MessageTypeSay MessageType = "say"
)

// AskType represents different types of ASK messages
type AskType string

const (
	AskTypeFollowup            AskType = "followup"
	AskTypePlanModeRespond     AskType = "plan_mode_respond"
	AskTypeCommand             AskType = "command"
	AskTypeCommandOutput       AskType = "command_output"
	AskTypeCompletionResult    AskType = "completion_result"
	AskTypeTool                AskType = "tool"
	AskTypeAPIReqFailed        AskType = "api_req_failed"
	AskTypeResumeTask          AskType = "resume_task"
	AskTypeResumeCompletedTask AskType = "resume_completed_task"
	AskTypeMistakeLimitReached AskType = "mistake_limit_reached"
	AskTypeBrowserActionLaunch AskType = "browser_action_launch"
	AskTypeUseMcpServer        AskType = "use_mcp_server"
	AskTypeNewTask             AskType = "new_task"
	AskTypeCondense            AskType = "condense"
	AskTypeReportBug           AskType = "report_bug"
)

// SayType represents different types of SAY messages
type SayType string

const (
	SayTypeTask                    SayType = "task"
	SayTypeError                   SayType = "error"
	SayTypeAPIReqStarted           SayType = "api_req_started"
	SayTypeAPIReqFinished          SayType = "api_req_finished"
	SayTypeText                    SayType = "text"
	SayTypeReasoning               SayType = "reasoning"
	SayTypeCompletionResult        SayType = "completion_result"
	SayTypeUserFeedback            SayType = "user_feedback"
	SayTypeUserFeedbackDiff        SayType = "user_feedback_diff"
	SayTypeAPIReqRetried           SayType = "api_req_retried"
	SayTypeErrorRetry              SayType = "error_retry"
	SayTypeCommand                 SayType = "command"
	SayTypeCommandOutput           SayType = "command_output"
	SayTypeTool                    SayType = "tool"
	SayTypeShellIntegrationWarning SayType = "shell_integration_warning"
	SayTypeBrowserActionLaunch     SayType = "browser_action_launch"
	SayTypeBrowserAction           SayType = "browser_action"
	SayTypeBrowserActionResult     SayType = "browser_action_result"
	SayTypeMcpServerRequestStarted SayType = "mcp_server_request_started"
	SayTypeMcpServerResponse       SayType = "mcp_server_response"
	SayTypeMcpNotification         SayType = "mcp_notification"
	SayTypeUseMcpServer            SayType = "use_mcp_server"
	SayTypeDiffError               SayType = "diff_error"
	SayTypeDeletedAPIReqs          SayType = "deleted_api_reqs"
	SayTypeClineignoreError        SayType = "clineignore_error"
	SayTypeCheckpointCreated       SayType = "checkpoint_created"
	SayTypeLoadMcpDocumentation    SayType = "load_mcp_documentation"
	SayTypeInfo                    SayType = "info"
	SayTypeTaskProgress            SayType = "task_progress"
	// Hook status streaming from the backend.
	// These values must match the backend "say" strings emitted by the extension.
	SayTypeHookStatus              SayType = "hook_status"
	SayTypeHookOutputStream        SayType = "hook_output_stream"
	SayTypeCommandPermissionDenied SayType = "command_permission_denied"
)

// ToolMessage represents a tool-related message
type ToolMessage struct {
	Tool                          string `json:"tool"`
	Path                          string `json:"path,omitempty"`
	Content                       string `json:"content,omitempty"`
	Diff                          string `json:"diff,omitempty"`
	Regex                         string `json:"regex,omitempty"`
	FilePattern                   string `json:"filePattern,omitempty"`
	OperationIsLocatedInWorkspace *bool  `json:"operationIsLocatedInWorkspace,omitempty"`
}

// ToolType represents different types of tools
type ToolType string

const (
	ToolTypeEditedExistingFile      ToolType = "editedExistingFile"
	ToolTypeNewFileCreated          ToolType = "newFileCreated"
	ToolTypeReadFile                ToolType = "readFile"
	ToolTypeFileDeleted             ToolType = "fileDeleted"
	ToolTypeListFilesTopLevel       ToolType = "listFilesTopLevel"
	ToolTypeListFilesRecursive      ToolType = "listFilesRecursive"
	ToolTypeListCodeDefinitionNames ToolType = "listCodeDefinitionNames"
	ToolTypeSearchFiles             ToolType = "searchFiles"
	ToolTypeWebFetch                ToolType = "webFetch"
	ToolTypeWebSearch               ToolType = "webSearch"
	ToolTypeSummarizeTask           ToolType = "summarizeTask"
)

// AskData represents the parsed structure of an ASK message
type AskData struct {
	Question string   `json:"question"`
	Response string   `json:"response"`
	Options  []string `json:"options,omitempty"`
}

// APIRequestInfo represents API request information
type APIRequestInfo struct {
	Request                string                 `json:"request,omitempty"`
	TokensIn               int                    `json:"tokensIn,omitempty"`
	TokensOut              int                    `json:"tokensOut,omitempty"`
	CacheWrites            int                    `json:"cacheWrites,omitempty"`
	CacheReads             int                    `json:"cacheReads,omitempty"`
	Cost                   float64                `json:"cost,omitempty"`
	CancelReason           string                 `json:"cancelReason,omitempty"`
	StreamingFailedMessage string                 `json:"streamingFailedMessage,omitempty"`
	RetryStatus            *APIRequestRetryStatus `json:"retryStatus,omitempty"`
}

// APIRequestRetryStatus represents retry status information
type APIRequestRetryStatus struct {
	Attempt      int    `json:"attempt"`
	MaxAttempts  int    `json:"maxAttempts"`
	DelaySec     int    `json:"delaySec"`
	ErrorSnippet string `json:"errorSnippet,omitempty"`
}

// HookMessage represents hook execution metadata sent from the backend
type HookMessage struct {
	HookName        string     `json:"hookName"`                  // Type of hook (TaskStart, PreToolUse, etc.)
	ToolName        string     `json:"toolName,omitempty"`        // Optional tool name for tool-specific hooks
	Status          string     `json:"status"`                    // "running", "completed", "cancelled", or "failed"
	ScriptPaths     []string   `json:"scriptPaths,omitempty"`     // Full paths to hook script(s)
	PendingToolInfo *ToolInfo  `json:"pendingToolInfo,omitempty"` // Metadata about the pending tool execution (PreToolUse)
	ExitCode        int        `json:"exitCode,omitempty"`        // Exit code for completed/failed hooks
	HasJsonResponse bool       `json:"hasJsonResponse,omitempty"` // Whether hook returned JSON
	Error           *HookError `json:"error,omitempty"`           // Error details if hook failed
}

// ToolInfo represents a compact subset of tool parameters for UI display.
// This mirrors the extension's pendingToolInfo shape and is used by the CLI to
// show what tool the PreToolUse hook is gating.
type ToolInfo struct {
	Tool        string `json:"tool"`
	Path        string `json:"path,omitempty"`
	Command     string `json:"command,omitempty"`
	Content     string `json:"content,omitempty"`
	Diff        string `json:"diff,omitempty"`
	Regex       string `json:"regex,omitempty"`
	Url         string `json:"url,omitempty"`
	McpTool     string `json:"mcpTool,omitempty"`
	McpServer   string `json:"mcpServer,omitempty"`
	ResourceUri string `json:"resourceUri,omitempty"`
}

// HookError represents structured error information from a failed hook
type HookError struct {
	Type       string `json:"type"`                 // Error type: "execution", "timeout", "validation", etc.
	Message    string `json:"message"`              // Human-readable error message
	Details    string `json:"details,omitempty"`    // Additional error details
	ScriptPath string `json:"scriptPath,omitempty"` // Path to script that failed
}

// GetTimestamp returns a formatted timestamp string
func (m *BeadsmithMessage) GetTimestamp() string {
	return time.Unix(m.Timestamp/1000, 0).Format("15:04:05")
}

// IsAsk returns true if this is an ASK message
func (m *BeadsmithMessage) IsAsk() bool {
	return m.Type == MessageTypeAsk
}

// IsSay returns true if this is a SAY message
func (m *BeadsmithMessage) IsSay() bool {
	return m.Type == MessageTypeSay
}

// GetMessageKey returns a unique key for this message based on timestamp
func (m *BeadsmithMessage) GetMessageKey() string {
	return strconv.FormatInt(m.Timestamp, 10)
}

// ExtractMessagesFromStateJSON parses the state JSON and extracts messages
func ExtractMessagesFromStateJSON(stateJson string) ([]*BeadsmithMessage, error) {
	// Parse the state JSON to extract beadsmithMessages
	var rawState map[string]interface{}
	if err := json.Unmarshal([]byte(stateJson), &rawState); err != nil {
		return nil, fmt.Errorf("failed to parse state JSON: %w", err)
	}

	// Try to extract beadsmithMessages
	beadsmithMessagesRaw, exists := rawState["beadsmithMessages"]
	if !exists {
		return []*BeadsmithMessage{}, nil
	}

	// Convert to JSON and back to get proper Message structs
	beadsmithMessagesJson, err := json.Marshal(beadsmithMessagesRaw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal beadsmithMessages: %w", err)
	}

	var messages []*BeadsmithMessage
	if err := json.Unmarshal(beadsmithMessagesJson, &messages); err != nil {
		return nil, fmt.Errorf("failed to unmarshal beadsmithMessages: %w", err)
	}

	return messages, nil
}

// ConvertProtoToMessage converts a protobuf BeadsmithMessage to our local Message struct
func ConvertProtoToMessage(protoMsg *cline.BeadsmithMessage) *BeadsmithMessage {
	var msgType MessageType
	var say, ask string

	// Convert message type
	switch protoMsg.Type {
	case cline.BeadsmithMessageType_ASK:
		msgType = MessageTypeAsk
		ask = convertProtoAskType(protoMsg.Ask)
	case cline.BeadsmithMessageType_SAY:
		msgType = MessageTypeSay
		say = convertProtoSayType(protoMsg.Say)
	default:
		msgType = MessageTypeSay
		say = "unknown"
	}

	return &BeadsmithMessage{
		Type:                        msgType,
		Text:                        protoMsg.Text,
		Timestamp:                   protoMsg.Ts,
		Reasoning:                   protoMsg.Reasoning,
		Say:                         say,
		Ask:                         ask,
		Partial:                     protoMsg.Partial,
		LastCheckpointHash:          protoMsg.LastCheckpointHash,
		IsCheckpointCheckedOut:      protoMsg.IsCheckpointCheckedOut,
		IsOperationOutsideWorkspace: protoMsg.IsOperationOutsideWorkspace,
	}
}

// convertProtoAskType converts protobuf ask type to string
func convertProtoAskType(askType cline.BeadsmithAsk) string {
	switch askType {
	case cline.BeadsmithAsk_FOLLOWUP:
		return string(AskTypeFollowup)
	case cline.BeadsmithAsk_PLAN_MODE_RESPOND:
		return string(AskTypePlanModeRespond)
	case cline.BeadsmithAsk_COMMAND:
		return string(AskTypeCommand)
	case cline.BeadsmithAsk_COMMAND_OUTPUT:
		return string(AskTypeCommandOutput)
	case cline.BeadsmithAsk_COMPLETION_RESULT:
		return string(AskTypeCompletionResult)
	case cline.BeadsmithAsk_TOOL:
		return string(AskTypeTool)
	case cline.BeadsmithAsk_API_REQ_FAILED:
		return string(AskTypeAPIReqFailed)
	case cline.BeadsmithAsk_RESUME_TASK:
		return string(AskTypeResumeTask)
	case cline.BeadsmithAsk_RESUME_COMPLETED_TASK:
		return string(AskTypeResumeCompletedTask)
	case cline.BeadsmithAsk_MISTAKE_LIMIT_REACHED:
		return string(AskTypeMistakeLimitReached)
	case cline.BeadsmithAsk_BROWSER_ACTION_LAUNCH:
		return string(AskTypeBrowserActionLaunch)
	case cline.BeadsmithAsk_USE_MCP_SERVER:
		return string(AskTypeUseMcpServer)
	case cline.BeadsmithAsk_NEW_TASK:
		return string(AskTypeNewTask)
	case cline.BeadsmithAsk_CONDENSE:
		return string(AskTypeCondense)
	case cline.BeadsmithAsk_REPORT_BUG:
		return string(AskTypeReportBug)
	default:
		return "unknown"
	}
}

// convertProtoSayType converts protobuf say type to string
func convertProtoSayType(sayType cline.BeadsmithSay) string {
	switch sayType {
	case cline.BeadsmithSay_TASK:
		return string(SayTypeTask)
	case cline.BeadsmithSay_ERROR:
		return string(SayTypeError)
	case cline.BeadsmithSay_API_REQ_STARTED:
		return string(SayTypeAPIReqStarted)
	case cline.BeadsmithSay_API_REQ_FINISHED:
		return string(SayTypeAPIReqFinished)
	case cline.BeadsmithSay_TEXT:
		return string(SayTypeText)
	case cline.BeadsmithSay_REASONING:
		return string(SayTypeReasoning)
	case cline.BeadsmithSay_COMPLETION_RESULT_SAY:
		return string(SayTypeCompletionResult)
	case cline.BeadsmithSay_USER_FEEDBACK:
		return string(SayTypeUserFeedback)
	case cline.BeadsmithSay_USER_FEEDBACK_DIFF:
		return string(SayTypeUserFeedbackDiff)
	case cline.BeadsmithSay_API_REQ_RETRIED:
		return string(SayTypeAPIReqRetried)
	case cline.BeadsmithSay_ERROR_RETRY:
		return string(SayTypeErrorRetry)
	case cline.BeadsmithSay_COMMAND_SAY:
		return string(SayTypeCommand)
	case cline.BeadsmithSay_COMMAND_OUTPUT_SAY:
		return string(SayTypeCommandOutput)
	case cline.BeadsmithSay_TOOL_SAY:
		return string(SayTypeTool)
	case cline.BeadsmithSay_SHELL_INTEGRATION_WARNING:
		return string(SayTypeShellIntegrationWarning)
	case cline.BeadsmithSay_BROWSER_ACTION_LAUNCH_SAY:
		return string(SayTypeBrowserActionLaunch)
	case cline.BeadsmithSay_BROWSER_ACTION:
		return string(SayTypeBrowserAction)
	case cline.BeadsmithSay_BROWSER_ACTION_RESULT:
		return string(SayTypeBrowserActionResult)
	case cline.BeadsmithSay_MCP_SERVER_REQUEST_STARTED:
		return string(SayTypeMcpServerRequestStarted)
	case cline.BeadsmithSay_MCP_SERVER_RESPONSE:
		return string(SayTypeMcpServerResponse)
	case cline.BeadsmithSay_MCP_NOTIFICATION:
		return string(SayTypeMcpNotification)
	case cline.BeadsmithSay_USE_MCP_SERVER_SAY:
		return string(SayTypeUseMcpServer)
	case cline.BeadsmithSay_DIFF_ERROR:
		return string(SayTypeDiffError)
	case cline.BeadsmithSay_DELETED_API_REQS:
		return string(SayTypeDeletedAPIReqs)
	case cline.BeadsmithSay_CLINEIGNORE_ERROR:
		return string(SayTypeClineignoreError)
	case cline.BeadsmithSay_CHECKPOINT_CREATED:
		return string(SayTypeCheckpointCreated)
	case cline.BeadsmithSay_LOAD_MCP_DOCUMENTATION:
		return string(SayTypeLoadMcpDocumentation)
	case cline.BeadsmithSay_INFO:
		return string(SayTypeInfo)
	case cline.BeadsmithSay_TASK_PROGRESS:
		return string(SayTypeTaskProgress)
	case cline.BeadsmithSay_HOOK_STATUS:
		return string(SayTypeHookStatus)
	case cline.BeadsmithSay_HOOK_OUTPUT_STREAM:
		return string(SayTypeHookOutputStream)
	case cline.BeadsmithSay_COMMAND_PERMISSION_DENIED:
		return string(SayTypeCommandPermissionDenied)
	default:
		return "unknown"
	}
}
