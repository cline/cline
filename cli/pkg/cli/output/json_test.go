package output

import (
	"encoding/json"
	"errors"
	"testing"
)

// TestFormatJSONResponse tests the FormatJSONResponse function
func TestFormatJSONResponse(t *testing.T) {
	tests := []struct {
		name     string
		status   string
		command  string
		data     interface{}
		errMsg   string
		wantErr  bool
		validate func(*testing.T, string)
	}{
		{
			name:    "success response with simple data",
			status:  "success",
			command: "test",
			data:    map[string]string{"key": "value"},
			errMsg:  "",
			wantErr: false,
			validate: func(t *testing.T, result string) {
				var resp JSONResponse
				if err := json.Unmarshal([]byte(result), &resp); err != nil {
					t.Fatalf("failed to parse JSON: %v", err)
				}
				if resp.Status != "success" {
					t.Errorf("expected status=success, got %s", resp.Status)
				}
				if resp.Command != "test" {
					t.Errorf("expected command=test, got %s", resp.Command)
				}
				if resp.Error != "" {
					t.Errorf("expected no error, got %s", resp.Error)
				}
			},
		},
		{
			name:    "error response",
			status:  "error",
			command: "test",
			data:    nil,
			errMsg:  "something went wrong",
			wantErr: false,
			validate: func(t *testing.T, result string) {
				var resp JSONResponse
				if err := json.Unmarshal([]byte(result), &resp); err != nil {
					t.Fatalf("failed to parse JSON: %v", err)
				}
				if resp.Status != "error" {
					t.Errorf("expected status=error, got %s", resp.Status)
				}
				if resp.Error != "something went wrong" {
					t.Errorf("expected error message, got %s", resp.Error)
				}
			},
		},
		{
			name:    "success with complex nested data",
			status:  "success",
			command: "version",
			data: map[string]interface{}{
				"cliVersion": "1.0.0",
				"nested": map[string]string{
					"key": "value",
				},
				"array": []string{"a", "b", "c"},
			},
			errMsg:  "",
			wantErr: false,
			validate: func(t *testing.T, result string) {
				var resp JSONResponse
				if err := json.Unmarshal([]byte(result), &resp); err != nil {
					t.Fatalf("failed to parse JSON: %v", err)
				}
				data := resp.Data.(map[string]interface{})
				if data["cliVersion"] != "1.0.0" {
					t.Errorf("expected cliVersion=1.0.0")
				}
			},
		},
		{
			name:    "nil data with success",
			status:  "success",
			command: "test",
			data:    nil,
			errMsg:  "",
			wantErr: false,
			validate: func(t *testing.T, result string) {
				var resp JSONResponse
				if err := json.Unmarshal([]byte(result), &resp); err != nil {
					t.Fatalf("failed to parse JSON: %v", err)
				}
				if resp.Data != nil {
					t.Errorf("expected nil data, got %v", resp.Data)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := FormatJSONResponse(tt.status, tt.command, tt.data, tt.errMsg)
			if (err != nil) != tt.wantErr {
				t.Errorf("FormatJSONResponse() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && tt.validate != nil {
				tt.validate(t, result)
			}
		})
	}
}

// TestOutputJSONSuccess tests the OutputJSONSuccess helper
func TestOutputJSONSuccess(t *testing.T) {
	// Note: This test would need to capture stdout which is complex
	// For now, we test that it doesn't panic and returns no error
	data := map[string]string{"test": "value"}
	err := OutputJSONSuccess("test", data)
	if err != nil {
		t.Errorf("OutputJSONSuccess() returned error: %v", err)
	}
}

// TestOutputJSONError tests the OutputJSONError helper
func TestOutputJSONError(t *testing.T) {
	// Note: This test would need to capture stdout which is complex
	// For now, we test that it doesn't panic and returns no error
	err := OutputJSONError("test", errors.New("test error"))
	if err != nil {
		t.Errorf("OutputJSONError() returned error: %v", err)
	}
}

// TestJSONResponseMarshaling tests that JSONResponse can be marshaled correctly
func TestJSONResponseMarshaling(t *testing.T) {
	tests := []struct {
		name     string
		response JSONResponse
		validate func(*testing.T, []byte)
	}{
		{
			name: "success response",
			response: JSONResponse{
				Status:  "success",
				Command: "test",
				Data:    map[string]string{"key": "value"},
			},
			validate: func(t *testing.T, data []byte) {
				var result map[string]interface{}
				if err := json.Unmarshal(data, &result); err != nil {
					t.Fatalf("failed to unmarshal: %v", err)
				}
				if result["status"] != "success" {
					t.Errorf("expected status=success")
				}
				if result["error"] != nil {
					t.Errorf("expected error field to be omitted or nil")
				}
			},
		},
		{
			name: "error response",
			response: JSONResponse{
				Status:  "error",
				Command: "test",
				Error:   "test error",
			},
			validate: func(t *testing.T, data []byte) {
				var result map[string]interface{}
				if err := json.Unmarshal(data, &result); err != nil {
					t.Fatalf("failed to unmarshal: %v", err)
				}
				if result["error"] != "test error" {
					t.Errorf("expected error=test error")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.response)
			if err != nil {
				t.Fatalf("Marshal() error = %v", err)
			}
			tt.validate(t, data)
		})
	}
}

// TestIsJSONMode tests the IsJSONMode helper
func TestIsJSONMode(t *testing.T) {
	// Note: This test would need to manipulate global.Config
	// For now we just test it doesn't panic
	_ = IsJSONMode()
}
