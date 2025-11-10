package types

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/cline/grpc-go/cline"
)

// ClineMessage represents a conversation message in the CLI
type ClineMessage struct {
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
	AskTypeBrowserActionLaunch    AskType = "browser_action_launch"
	AskTypeUseMcpServer           AskType = "use_mcp_server"
	AskTypeNewTask                AskType = "new_task"
	AskTypeCondense               AskType = "condense"
	AskTypeReportBug              AskType = "report_bug"
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

// GetTimestamp returns a formatted timestamp string
func (m *ClineMessage) GetTimestamp() string {
	return time.Unix(m.Timestamp/1000, 0).Format("15:04:05")
}

// IsAsk returns true if this is an ASK message
func (m *ClineMessage) IsAsk() bool {
	return m.Type == MessageTypeAsk
}

// IsSay returns true if this is a SAY message
func (m *ClineMessage) IsSay() bool {
	return m.Type == MessageTypeSay
}

// GetMessageKey returns a unique key for this message based on timestamp
func (m *ClineMessage) GetMessageKey() string {
	return strconv.FormatInt(m.Timestamp, 10)
}

// ExtractMessagesFromStateJSON parses the state JSON and extracts messages
func ExtractMessagesFromStateJSON(stateJson string) ([]*ClineMessage, error) {
	// Parse the state JSON to extract clineMessages
	var rawState map[string]interface{}
	if err := json.Unmarshal([]byte(stateJson), &rawState); err != nil {
		return nil, fmt.Errorf("failed to parse state JSON: %w", err)
	}

	// Try to extract clineMessages
	clineMessagesRaw, exists := rawState["clineMessages"]
	if !exists {
		return []*ClineMessage{}, nil
	}

	// Convert to JSON and back to get proper Message structs
	clineMessagesJson, err := json.Marshal(clineMessagesRaw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal clineMessages: %w", err)
	}

	var messages []*ClineMessage
	if err := json.Unmarshal(clineMessagesJson, &messages); err != nil {
		return nil, fmt.Errorf("failed to unmarshal clineMessages: %w", err)
	}

	return messages, nil
}

// ConvertProtoToMessage converts a protobuf ClineMessage to our local Message struct
func ConvertProtoToMessage(protoMsg *cline.ClineMessage) *ClineMessage {
	var msgType MessageType
	var say, ask string

	// Convert message type
	switch protoMsg.Type {
	case cline.ClineMessageType_ASK:
		msgType = MessageTypeAsk
		ask = convertProtoAskType(protoMsg.Ask)
	case cline.ClineMessageType_SAY:
		msgType = MessageTypeSay
		say = convertProtoSayType(protoMsg.Say)
	default:
		msgType = MessageTypeSay
		say = "unknown"
	}

	return &ClineMessage{
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
func convertProtoAskType(askType cline.ClineAsk) string {
	switch askType {
	case cline.ClineAsk_FOLLOWUP:
		return string(AskTypeFollowup)
	case cline.ClineAsk_PLAN_MODE_RESPOND:
		return string(AskTypePlanModeRespond)
	case cline.ClineAsk_COMMAND:
		return string(AskTypeCommand)
	case cline.ClineAsk_COMMAND_OUTPUT:
		return string(AskTypeCommandOutput)
	case cline.ClineAsk_COMPLETION_RESULT:
		return string(AskTypeCompletionResult)
	case cline.ClineAsk_TOOL:
		return string(AskTypeTool)
	case cline.ClineAsk_API_REQ_FAILED:
		return string(AskTypeAPIReqFailed)
	case cline.ClineAsk_RESUME_TASK:
		return string(AskTypeResumeTask)
	case cline.ClineAsk_RESUME_COMPLETED_TASK:
		return string(AskTypeResumeCompletedTask)
	case cline.ClineAsk_MISTAKE_LIMIT_REACHED:
		return string(AskTypeMistakeLimitReached)
	case cline.ClineAsk_BROWSER_ACTION_LAUNCH:
		return string(AskTypeBrowserActionLaunch)
	case cline.ClineAsk_USE_MCP_SERVER:
		return string(AskTypeUseMcpServer)
	case cline.ClineAsk_NEW_TASK:
		return string(AskTypeNewTask)
	case cline.ClineAsk_CONDENSE:
		return string(AskTypeCondense)
	case cline.ClineAsk_REPORT_BUG:
		return string(AskTypeReportBug)
	default:
		return "unknown"
	}
}

// convertProtoSayType converts protobuf say type to string
func convertProtoSayType(sayType cline.ClineSay) string {
	switch sayType {
	case cline.ClineSay_TASK:
		return string(SayTypeTask)
	case cline.ClineSay_ERROR:
		return string(SayTypeError)
	case cline.ClineSay_API_REQ_STARTED:
		return string(SayTypeAPIReqStarted)
	case cline.ClineSay_API_REQ_FINISHED:
		return string(SayTypeAPIReqFinished)
	case cline.ClineSay_TEXT:
		return string(SayTypeText)
	case cline.ClineSay_REASONING:
		return string(SayTypeReasoning)
	case cline.ClineSay_COMPLETION_RESULT_SAY:
		return string(SayTypeCompletionResult)
	case cline.ClineSay_USER_FEEDBACK:
		return string(SayTypeUserFeedback)
	case cline.ClineSay_USER_FEEDBACK_DIFF:
		return string(SayTypeUserFeedbackDiff)
	case cline.ClineSay_API_REQ_RETRIED:
		return string(SayTypeAPIReqRetried)
	case cline.ClineSay_ERROR_RETRY:
		return string(SayTypeErrorRetry)
	case cline.ClineSay_COMMAND_SAY:
		return string(SayTypeCommand)
	case cline.ClineSay_COMMAND_OUTPUT_SAY:
		return string(SayTypeCommandOutput)
	case cline.ClineSay_TOOL_SAY:
		return string(SayTypeTool)
	case cline.ClineSay_SHELL_INTEGRATION_WARNING:
		return string(SayTypeShellIntegrationWarning)
	case cline.ClineSay_BROWSER_ACTION_LAUNCH_SAY:
		return string(SayTypeBrowserActionLaunch)
	case cline.ClineSay_BROWSER_ACTION:
		return string(SayTypeBrowserAction)
	case cline.ClineSay_BROWSER_ACTION_RESULT:
		return string(SayTypeBrowserActionResult)
	case cline.ClineSay_MCP_SERVER_REQUEST_STARTED:
		return string(SayTypeMcpServerRequestStarted)
	case cline.ClineSay_MCP_SERVER_RESPONSE:
		return string(SayTypeMcpServerResponse)
	case cline.ClineSay_MCP_NOTIFICATION:
		return string(SayTypeMcpNotification)
	case cline.ClineSay_USE_MCP_SERVER_SAY:
		return string(SayTypeUseMcpServer)
	case cline.ClineSay_DIFF_ERROR:
		return string(SayTypeDiffError)
	case cline.ClineSay_DELETED_API_REQS:
		return string(SayTypeDeletedAPIReqs)
	case cline.ClineSay_CLINEIGNORE_ERROR:
		return string(SayTypeClineignoreError)
	case cline.ClineSay_CHECKPOINT_CREATED:
		return string(SayTypeCheckpointCreated)
	case cline.ClineSay_LOAD_MCP_DOCUMENTATION:
		return string(SayTypeLoadMcpDocumentation)
	case cline.ClineSay_INFO:
		return string(SayTypeInfo)
	case cline.ClineSay_TASK_PROGRESS:
		return string(SayTypeTaskProgress)
	default:
		return "unknown"
	}
}
