package display

import (
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/clerror"
)

// ErrorSeverity represents the severity level of an error
type ErrorSeverity string

const (
	SeverityCritical ErrorSeverity = "critical"
	SeverityWarning  ErrorSeverity = "warning"
	SeverityInfo     ErrorSeverity = "info"
)

// SystemMessageRenderer handles rendering of system messages (errors, warnings, info)
type SystemMessageRenderer struct {
	renderer     *Renderer
	mdRenderer   *MarkdownRenderer
	outputFormat string
}

// NewSystemMessageRenderer creates a new system message renderer
func NewSystemMessageRenderer(renderer *Renderer, mdRenderer *MarkdownRenderer, outputFormat string) *SystemMessageRenderer {
	return &SystemMessageRenderer{
		renderer:     renderer,
		mdRenderer:   mdRenderer,
		outputFormat: outputFormat,
	}
}

// RenderError renders a beautiful error message with optional details
func (sr *SystemMessageRenderer) RenderError(severity ErrorSeverity, title, body string, details map[string]string) error {
	var colorMarkdown string

	switch severity {
	case SeverityCritical:
		colorMarkdown = "**[ERROR]**"
	case SeverityWarning:
		colorMarkdown = "**[WARNING]**"
	case SeverityInfo:
		colorMarkdown = "**[INFO]**"
	}

	// Build the error message in markdown
	var parts []string

	// Header
	header := fmt.Sprintf("### %s %s", colorMarkdown, title)
	parts = append(parts, header)

	// Body
	if body != "" {
		parts = append(parts, "", body)
	}

	// Details
	if len(details) > 0 {
		parts = append(parts, "", "**Details:**")
		for key, value := range details {
			parts = append(parts, fmt.Sprintf("- %s: `%s`", key, value))
		}
	}

	markdown := strings.Join(parts, "\n")
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	return nil
}

// RenderBalanceError renders a special balance/credits error with helpful info
func (sr *SystemMessageRenderer) RenderBalanceError(err *clerror.ClineError) error {
	var parts []string

	// Header
	parts = append(parts, "### **[ERROR]** Credit Limit Reached")
	parts = append(parts, "")

	// Message - prefer detail message from error.details, fallback to main message
	message := err.Message
	if detailMsg := err.GetDetailMessage(); detailMsg != "" {
		message = detailMsg
	}
	parts = append(parts, message)
	parts = append(parts, "")

	// Account Balance section
	parts = append(parts, "**Account Balance:**")

	// Current balance
	if balance := err.GetCurrentBalance(); balance != nil {
		parts = append(parts, fmt.Sprintf("- Current Balance: **$%.2f**", *balance))
	}

	// Total spent
	if spent := err.GetTotalSpent(); spent != nil {
		parts = append(parts, fmt.Sprintf("- Total Spent: $%.2f", *spent))
	}

	// Promotions applied
	if promos := err.GetTotalPromotions(); promos != nil {
		parts = append(parts, fmt.Sprintf("- Promotions Applied: $%.2f", *promos))
	}

	parts = append(parts, "")

	// Buy credits link
	if url := err.GetBuyCreditsURL(); url != "" {
		parts = append(parts, fmt.Sprintf("**→ Buy credits:** %s", url))
	} else {
		// Fallback - show both personal and org URLs
		parts = append(parts, "**→ Buy credits:**")
		parts = append(parts, "  - Personal: https://app.cline.bot/dashboard/account?tab=credits")
		parts = append(parts, "  - Organization: https://app.cline.bot/dashboard/organization?tab=credits")
	}

	// Request ID (less prominent at the end)
	if err.RequestID != "" {
		parts = append(parts, "")
		parts = append(parts, fmt.Sprintf("*Request ID: %s*", err.RequestID))
	}

	markdown := strings.Join(parts, "\n")
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	return nil
}

// RenderAuthError renders an authentication error with helpful guidance
func (sr *SystemMessageRenderer) RenderAuthError(err *clerror.ClineError) error {
	var parts []string

	// Header
	parts = append(parts, "### **[ERROR]** Authentication Failed")
	parts = append(parts, "")

	// Message - prefer detail message if available
	message := err.Message
	if detailMsg := err.GetDetailMessage(); detailMsg != "" {
		message = detailMsg
	}
	parts = append(parts, message)
	parts = append(parts, "")

	// Guidance
	parts = append(parts, "**Next Steps:**")
	parts = append(parts, "- Check your API key configuration")
	parts = append(parts, "- Run `cline auth` to authenticate")
	parts = append(parts, "- Verify your account status at https://app.cline.bot")

	// Request ID
	if err.RequestID != "" {
		parts = append(parts, "")
		parts = append(parts, fmt.Sprintf("*Request ID: `%s`*", err.RequestID))
	}

	markdown := strings.Join(parts, "\n")
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	return nil
}

// RenderRateLimitError renders a rate limit error with request ID
func (sr *SystemMessageRenderer) RenderRateLimitError(err *clerror.ClineError) error {
	var parts []string

	// Header
	parts = append(parts, "### **[WARNING]** Rate Limit Reached")
	parts = append(parts, "")

	// Message - prefer detail message if available
	message := err.Message
	if detailMsg := err.GetDetailMessage(); detailMsg != "" {
		message = detailMsg
	}
	parts = append(parts, message)
	parts = append(parts, "")

	// Guidance
	parts = append(parts, "The API will automatically retry this request.")

	// Request ID
	if err.RequestID != "" {
		parts = append(parts, "")
		parts = append(parts, fmt.Sprintf("*Request ID: `%s`*", err.RequestID))
	}

	markdown := strings.Join(parts, "\n")
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	return nil
}

// RenderAPIError renders a generic API error with all available details
func (sr *SystemMessageRenderer) RenderAPIError(err *clerror.ClineError) error {
	var parts []string

	// Header
	parts = append(parts, "### **[ERROR]** API Request Failed")
	parts = append(parts, "")

	// Message - prefer detail message if available
	message := err.Message
	if detailMsg := err.GetDetailMessage(); detailMsg != "" {
		message = detailMsg
	}
	parts = append(parts, message)

	// Details
	var details []string
	if err.RequestID != "" {
		details = append(details, fmt.Sprintf("- Request ID: `%s`", err.RequestID))
	}
	if code := err.GetCodeString(); code != "" {
		details = append(details, fmt.Sprintf("- Error Code: `%s`", code))
	}
	if err.Status > 0 {
		details = append(details, fmt.Sprintf("- HTTP Status: `%d`", err.Status))
	}
	if err.ModelID != "" {
		details = append(details, fmt.Sprintf("- Model: `%s`", err.ModelID))
	}
	if err.ProviderID != "" {
		details = append(details, fmt.Sprintf("- Provider: `%s`", err.ProviderID))
	}

	if len(details) > 0 {
		parts = append(parts, "")
		parts = append(parts, "**Details:**")
		parts = append(parts, strings.Join(details, "\n"))
	}

	markdown := strings.Join(parts, "\n")
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	return nil
}

// RenderWarning renders a warning message
func (sr *SystemMessageRenderer) RenderWarning(title, message string) error {
	markdown := fmt.Sprintf("### **[WARNING]** %s\n\n%s", title, message)
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)
	return nil
}

// RenderInfo renders an info message
func (sr *SystemMessageRenderer) RenderInfo(title, message string) error {
	markdown := fmt.Sprintf("### **[INFO]** %s\n\n%s", title, message)
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)
	return nil
}

// RenderCheckpoint renders a checkpoint creation message
func (sr *SystemMessageRenderer) RenderCheckpoint(timestamp string, id int64) error {
	markdown := fmt.Sprintf("## [%s] Checkpoint created `%d`", timestamp, id)
	rendered := sr.renderer.RenderMarkdown(markdown)
	fmt.Printf(rendered)
	return nil
}
