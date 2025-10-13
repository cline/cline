package clerror

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ClineErrorType represents the category of error
type ClineErrorType string

const (
	ErrorTypeAuth      ClineErrorType = "auth"
	ErrorTypeNetwork   ClineErrorType = "network"
	ErrorTypeRateLimit ClineErrorType = "rateLimit"
	ErrorTypeBalance   ClineErrorType = "balance"
	ErrorTypeUnknown   ClineErrorType = "unknown"
)

// ClineError represents a parsed error from Cline API
type ClineError struct {
	Message    string                 `json:"message"`
	Status     int                    `json:"status"`
	RequestID  string                 `json:"request_id"`
	Code       interface{}            `json:"code"` // Can be string or int
	ModelID    string                 `json:"modelId"`
	ProviderID string                 `json:"providerId"`
	Details    map[string]interface{} `json:"details"`
}

// GetCodeString returns the code as a string regardless of its type
func (e *ClineError) GetCodeString() string {
	if e == nil || e.Code == nil {
		return ""
	}
	switch v := e.Code.(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%.0f", v)
	case int:
		return fmt.Sprintf("%d", v)
	default:
		return fmt.Sprintf("%v", v)
	}
}

// Rate limit patterns from webview
var rateLimitPatterns = []string{
	"status code 429",
	"rate limit",
	"too many requests",
	"quota exceeded",
	"resource exhausted",
}

// ParseClineError parses a JSON error string into a ClineError
func ParseClineError(errorJSON string) (*ClineError, error) {
	if errorJSON == "" {
		return nil, nil
	}

	var err ClineError
	if parseErr := json.Unmarshal([]byte(errorJSON), &err); parseErr != nil {
		// If JSON parsing fails, create a simple error with the message
		return &ClineError{
			Message: errorJSON,
		}, nil
	}

	return &err, nil
}

// GetErrorType determines the type of error based on code, status, and message
func (e *ClineError) GetErrorType() ClineErrorType {
	if e == nil {
		return ErrorTypeUnknown
	}

	// Check balance error first (most specific)
	codeStr := e.GetCodeString()
	if codeStr == "insufficient_credits" {
		return ErrorTypeBalance
	}

	// Check auth errors
	if codeStr == "ERR_BAD_REQUEST" || e.Status == 401 {
		return ErrorTypeAuth
	}

	// Check for auth message
	if strings.Contains(e.Message, "Authentication required") ||
		strings.Contains(e.Message, "Invalid API key") ||
		strings.Contains(e.Message, "Unauthorized") {
		return ErrorTypeAuth
	}

	// Check rate limit patterns
	messageLower := strings.ToLower(e.Message)
	for _, pattern := range rateLimitPatterns {
		if strings.Contains(messageLower, pattern) {
			return ErrorTypeRateLimit
		}
	}

	return ErrorTypeUnknown
}

// IsBalanceError returns true if this is a balance/credits error
func (e *ClineError) IsBalanceError() bool {
	return e.GetErrorType() == ErrorTypeBalance
}

// IsAuthError returns true if this is an authentication error
func (e *ClineError) IsAuthError() bool {
	return e.GetErrorType() == ErrorTypeAuth
}

// IsRateLimitError returns true if this is a rate limit error
func (e *ClineError) IsRateLimitError() bool {
	return e.GetErrorType() == ErrorTypeRateLimit
}

// GetCurrentBalance returns the current balance if available
func (e *ClineError) GetCurrentBalance() *float64 {
	if e == nil || e.Details == nil {
		return nil
	}

	if balance, ok := e.Details["current_balance"].(float64); ok {
		return &balance
	}

	return nil
}

// GetBuyCreditsURL returns the URL to buy credits if available
func (e *ClineError) GetBuyCreditsURL() string {
	if e == nil || e.Details == nil {
		return ""
	}

	if url, ok := e.Details["buy_credits_url"].(string); ok {
		return url
	}

	return ""
}

// GetTotalSpent returns the total spent amount if available
func (e *ClineError) GetTotalSpent() *float64 {
	if e == nil || e.Details == nil {
		return nil
	}

	if spent, ok := e.Details["total_spent"].(float64); ok {
		return &spent
	}

	return nil
}

// GetTotalPromotions returns the total promotions amount if available
func (e *ClineError) GetTotalPromotions() *float64 {
	if e == nil || e.Details == nil {
		return nil
	}

	if promos, ok := e.Details["total_promotions"].(float64); ok {
		return &promos
	}

	return nil
}

// GetDetailMessage returns the detail message from error.details if available
func (e *ClineError) GetDetailMessage() string {
	if e == nil || e.Details == nil {
		return ""
	}

	if msg, ok := e.Details["message"].(string); ok {
		return msg
	}

	return ""
}
