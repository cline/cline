package output

import (
	"encoding/json"
	"fmt"
)

// OutputJSONLine outputs a single JSON object as a line (JSONL format)
func OutputJSONLine(obj map[string]interface{}) error {
	jsonBytes, err := json.Marshal(obj)
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}
	fmt.Println(string(jsonBytes))
	return nil
}

// OutputStatusMessage outputs a status message in JSONL format
// Caller should check output mode before calling this function
func OutputStatusMessage(msgType, message string, data map[string]interface{}) error {
	obj := map[string]interface{}{
		"type":    msgType,
		"message": message,
	}

	if data != nil {
		for k, v := range data {
			obj[k] = v
		}
	}

	return OutputJSONLine(obj)
}

// JSONResponse represents a standard CLI JSON response
type JSONResponse struct {
	Status  string      `json:"status"`          // "success" or "error"
	Command string      `json:"command"`         // e.g., "instance list"
	Data    interface{} `json:"data,omitempty"`  // Response data (only for success)
	Error   string      `json:"error,omitempty"` // Error message (only for error)
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

// OutputCommandStatus outputs a command status message in batch format
func OutputCommandStatus(command, status, message string, data map[string]interface{}) error {
	obj := map[string]interface{}{
		"type":    "command",
		"command": command,
		"status":  status,
	}

	if message != "" {
		obj["message"] = message
	}

	if data != nil {
		obj["data"] = data
	}

	return OutputJSONLine(obj)
}

// OutputJSONSuccess outputs a successful JSON response as a single JSONL line
func OutputJSONSuccess(command string, data interface{}) error {
	response := map[string]interface{}{
		"type":    "command",
		"command": command,
		"status":  "success",
		"data":    data,
	}
	return OutputJSONLine(response)
}

// OutputJSONError outputs an error JSON response
func OutputJSONError(command string, err error) error {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	return OutputJSON("error", command, nil, errMsg)
}
