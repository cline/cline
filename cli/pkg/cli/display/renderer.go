package display

import (
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/cli/types"
	"github.com/cline/grpc-go/cline"
)

type Renderer struct {
	typewriter   *TypewriterPrinter
	mdRenderer   *MarkdownRenderer
	outputFormat string
}

func NewRenderer(outputFormat string) *Renderer {
	mdRenderer, err := NewMarkdownRenderer()
	if err != nil {
		mdRenderer = nil
	}

	return &Renderer{
		typewriter:   NewTypewriterPrinter(DefaultTypewriterConfig()),
		mdRenderer:   mdRenderer,
		outputFormat: outputFormat,
	}
}

func (r *Renderer) RenderMessage(prefix, text string, newline bool) error {
	if text == "" {
		return nil
	}

	clean := r.sanitizeText(text)
	if clean == "" {
		return nil
	}

	if newline {
		output.Printf("%s: %s\n", prefix, clean)
	} else {
		output.Printf("%s: %s", prefix, clean)
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
    parts := make([]string, 0, 4)

    if tokensIn != 0 {
        parts = append(parts, fmt.Sprintf("↑ %s", formatNumber(tokensIn)))
    }
    if tokensOut != 0 {
        parts = append(parts, fmt.Sprintf("↓ %s", formatNumber(tokensOut)))
    }
    if cacheReads != 0 {
        parts = append(parts, fmt.Sprintf("→ %s", formatNumber(cacheReads)))
    }
    if cacheWrites != 0 {
        parts = append(parts, fmt.Sprintf("← %s", formatNumber(cacheWrites)))
    }

    if len(parts) == 0 {
        return fmt.Sprintf("$%.4f", cost)
    }

    return fmt.Sprintf("%s $%.4f", strings.Join(parts, " "), cost)
}


func (r *Renderer) RenderAPI(status string, apiInfo *types.APIRequestInfo) error {
	if apiInfo.Cost >= 0 {
		usageInfo := r.formatUsageInfo(apiInfo.TokensIn, apiInfo.TokensOut, apiInfo.CacheReads, apiInfo.CacheWrites, apiInfo.Cost)
		markdown := fmt.Sprintf("## API %s `%s`", status, usageInfo)
		rendered := r.RenderMarkdown(markdown)
		output.Print(rendered)
	} else {
		// honestly i see no point in showing "### API processing request" here...
		// markdown := fmt.Sprintf("## API %s", status)
		// rendered := r.RenderMarkdown(markdown)
		// output.Printf("\n%s\n", rendered)
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

func (r *Renderer) RenderTaskCancelled() error {
	markdown := "## Task cancelled"
	rendered := r.RenderMarkdown(markdown)
	output.Printf("\n%s\n", rendered)
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

	// Check for JSON output mode
	if r.outputFormat == "json" {
		// Build JSON structure
		taskList := make([]map[string]interface{}, len(recentTasks))
		for i, taskItem := range recentTasks {
			description := taskItem.Task
			if len(description) > 1000 {
				description = description[:1000] + "..."
			}
			
			taskList[i] = map[string]interface{}{
				"id":          taskItem.Id,
				"task":        description,
				"ts":          taskItem.Ts,
				"isFavorited": taskItem.IsFavorited,
				"size":        taskItem.Size,
				"totalCost":   taskItem.TotalCost,
				"tokensIn":    taskItem.TokensIn,
				"tokensOut":   taskItem.TokensOut,
				"cacheWrites": taskItem.CacheWrites,
				"cacheReads":  taskItem.CacheReads,
			}
		}
		
		data := map[string]interface{}{
			"tasks":      taskList,
			"totalCount": len(tasks),
			"shown":      len(recentTasks),
		}
		return output.OutputJSONSuccess("task list", data)
	}

	// Rich/plain output
	r.typewriter.PrintfLn("=== Task History (showing last %d of %d total tasks) ===\n", len(recentTasks), len(tasks))

	for i, taskItem := range recentTasks {
		r.typewriter.PrintfLn("Task ID: %s", taskItem.Id)

		description := taskItem.Task
		if len(description) > 1000 {
			description = description[:1000] + "..."
		}
		r.typewriter.PrintfLn("Message: %s", description)

		usageInfo := r.formatUsageInfo(int(taskItem.TokensIn), int(taskItem.TokensOut), int(taskItem.CacheReads), int(taskItem.CacheWrites), taskItem.TotalCost)
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
		
		// In JSON mode, output as JSONL immediately
		if global.Config.OutputFormat == "json" {
			return output.OutputStatusMessage("debug", message, nil)
		}
		
		// In plain/rich mode, output as text
		r.typewriter.PrintMessageLine("[DEBUG]", message)
	}
	return nil
}

func (r *Renderer) ClearLine() {
	output.Print("\r\033[K")
}

func (r *Renderer) MoveCursorUp(n int) {
	output.Printf("\033[%dA", n)
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

func (r *Renderer) GetMdRenderer() *MarkdownRenderer {
	return r.mdRenderer
}

// RenderMarkdown renders markdown text to terminal format with ANSI codes
// Falls back to plaintext if markdown rendering is unavailable or fails
// Respects output format - skips rendering in plain mode
func (r *Renderer) RenderMarkdown(markdown string) string {
	// Skip markdown rendering in plain mode
	if r.outputFormat == "plain" {
		return markdown
	}
	
	if r.mdRenderer == nil {
		return markdown
	}
	
	rendered, err := r.mdRenderer.Render(markdown)
	if err != nil {
		return markdown
	}
	
	return rendered
}
