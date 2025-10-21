package output

import (
	"encoding/json"
	"fmt"

	"github.com/cline/cli/pkg/cli/global"
)

// JSONResponse represents a standard CLI JSON response
type JSONResponse struct {
	Status  string      `json:"status"`            // "success" or "error"
	Command string      `json:"command"`           // e.g., "instance list"
	Data    interface{} `json:"data,omitempty"`    // Response data (only for success)
	Error   string      `json:"error,omitempty"`   // Error message (only for error)
}

// FormatJSONResponse creates a JSON response string
func FormatJSONResponse(status, command string, data interface{}, errMsg string) (string, error) {
	response := JSONResponse{
		Status:  status,
		Command: command,
		Data:    data,
		Error:   errMsg,
	}

	jsonBytes, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal JSON response: %w", err)
	}

	return string(jsonBytes), nil
}

// OutputJSON prints a JSON response to stdout
func OutputJSON(status, command string, data interface{}, errMsg string) error {
	jsonStr, err := FormatJSONResponse(status, command, data, errMsg)
	if err != nil {
		return err
	}

	fmt.Println(jsonStr)
	return nil
}

// OutputJSONSuccess outputs a successful JSON response
func OutputJSONSuccess(command string, data interface{}) error {
	return OutputJSON("success", command, data, "")
}

// OutputJSONError outputs an error JSON response
func OutputJSONError(command string, err error) error {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	return OutputJSON("error", command, nil, errMsg)
}

// IsJSONMode returns true if global output format is set to JSON
func IsJSONMode() bool {
	if global.Config == nil {
		return false
	}
	return global.Config.OutputFormat == "json"
}
