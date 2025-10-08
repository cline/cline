package display

import (
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/types"
	"github.com/cline/grpc-go/cline"
)

type Renderer struct {
	typewriter *TypewriterPrinter
}

func NewRenderer() *Renderer {
	return &Renderer{
		typewriter: NewTypewriterPrinter(DefaultTypewriterConfig()),
	}
}

func (r *Renderer) RenderMessage(prefix, text string) error {
	if text == "" {
		return nil
	}

	cleanText := r.sanitizeText(text)
	if cleanText == "" {
		return nil
	}

	fmt.Printf("%s: %s\n", prefix, cleanText)
	return nil
}

func (r *Renderer) RenderMessageWithTimestamp(timestamp, prefix, text string) error {
	if text == "" {
		return nil
	}

	cleanText := r.sanitizeText(text)
	if cleanText == "" {
		return nil
	}

	fmt.Printf("[%s] %s: %s\n", timestamp, prefix, cleanText)
	return nil
}

func (r *Renderer) RenderCommand(command string, isExecuting bool) error {
	if isExecuting {
		r.typewriter.PrintMessageLine("EXEC", command)
	} else {
		r.typewriter.PrintMessageLine("CMD", command)
	}
	return nil
}

// formatNumber formats numbers with k/m abbreviations
func formatNumber(n int) string {
	if n >= 1000000 {
		return fmt.Sprintf("%.1fm", float64(n)/1000000.0)
	} else if n >= 1000 {
		return fmt.Sprintf("%.1fk", float64(n)/1000.0)
	}
	return fmt.Sprintf("%d", n)
}

// formatUsageInfo formats token usage information (extracted from RenderAPI)
func (r *Renderer) formatUsageInfo(tokensIn, tokensOut, cacheReads, cacheWrites int, cost float64) string {
	tokenDetails := fmt.Sprintf("[tokens in: %s, out: %s; cache read: %s, write: %s]",
		formatNumber(tokensIn),
		formatNumber(tokensOut),
		formatNumber(cacheReads),
		formatNumber(cacheWrites))

	return fmt.Sprintf("%s ($%.4f)", tokenDetails, cost)
}

func (r *Renderer) RenderAPI(status string, apiInfo *types.APIRequestInfo) error {
	if apiInfo.Cost >= 0 {
		message := fmt.Sprintf("%s %s", status, r.formatUsageInfo(apiInfo.TokensIn, apiInfo.TokensOut, apiInfo.CacheReads, apiInfo.CacheWrites, apiInfo.Cost))
		r.typewriter.PrintMessageLine("API INFO", message)
	} else {
		r.typewriter.PrintMessageLine("API INFO", status)
	}
	return nil
}

func (r *Renderer) RenderRetry(attempt, maxAttempts, delaySec int) error {
	message := fmt.Sprintf("Retrying failed attempt %d/%d", attempt, maxAttempts)
	if delaySec > 0 {
		message += fmt.Sprintf(" in %d seconds", delaySec)
	}
	message += "..."
	r.typewriter.PrintMessageLine("API INFO", message)
	return nil
}

// RenderTaskList displays task history with improved formatting
func (r *Renderer) RenderTaskList(tasks []*cline.TaskItem) error {
	const maxTasks = 20

	startIndex := 0
	if len(tasks) > maxTasks {
		startIndex = len(tasks) - maxTasks
	}

	recentTasks := tasks[startIndex:]

	r.typewriter.PrintfLn("=== Task History (showing last %d of %d total tasks) ===\n", len(recentTasks), len(tasks))

	for i, task := range recentTasks {
		r.typewriter.PrintfLn("Task ID: %s", task.Id)

		description := task.Task
		if len(description) > 1000 {
			description = description[:1000] + "..."
		}
		r.typewriter.PrintfLn("Message: %s", description)

		usageInfo := r.formatUsageInfo(int(task.TokensIn), int(task.TokensOut), int(task.CacheReads), int(task.CacheWrites), task.TotalCost)
		r.typewriter.PrintfLn("Usage  : %s", usageInfo)

		// Single space between tasks (except last)
		if i < len(recentTasks)-1 {
			r.typewriter.PrintfLn("")
		}
	}

	return nil
}

func (r *Renderer) RenderDebug(format string, args ...interface{}) error {
	if global.Config.Verbose {
		message := fmt.Sprintf(format, args...)
		r.typewriter.PrintMessageLine("[DEBUG]", message)
	}
	return nil
}

func (r *Renderer) ClearLine() {
	fmt.Print("\r\033[K")
}

func (r *Renderer) MoveCursorUp(n int) {
	fmt.Printf("\033[%dA", n)
}

func (r *Renderer) sanitizeText(text string) string {
	text = strings.TrimSpace(text)

	if text == "" {
		return ""
	}

	// Remove control characters and escape sequences
	var result strings.Builder
	for _, r := range text {
		// Keep printable characters, spaces, tabs, and newlines
		if r >= 32 || r == '\t' || r == '\n' || r == '\r' {
			result.WriteRune(r)
		}
		// Skip control characters (0-31 except tab, newline, carriage return)
	}

	return result.String()
}

func (r *Renderer) SetTypewriterEnabled(enabled bool) {
	r.typewriter.SetEnabled(enabled)
}

func (r *Renderer) IsTypewriterEnabled() bool {
	return r.typewriter.IsEnabled()
}

func (r *Renderer) SetTypewriterSpeed(multiplier float64) {
	r.typewriter.SetSpeed(multiplier)
}

func (r *Renderer) GetTypewriter() *TypewriterPrinter {
	return r.typewriter
}
