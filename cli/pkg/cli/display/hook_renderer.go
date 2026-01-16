package display

import (
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/types"
)

// HookRenderer renders hook status messages in a CLI-native style.
//
// Goals:
// - Match ToolRenderer’s markdown look
// - Keep executions ungrouped
// - Render status + high-signal metadata (script paths, error summary)
//
// Note: hook stdout/stderr currently arrives as separate `hook_output_stream` messages.
// The CLI suppresses those by default and prints them only in --verbose mode.
// Future work could group streamed output under the corresponding hook block.
//
// It returns markdown (or rendered markdown when enabled); callers should print the
// returned string.

type HookRenderer struct {
	mdRenderer   *MarkdownRenderer
	outputFormat string
}

func NewHookRenderer(mdRenderer *MarkdownRenderer, outputFormat string) *HookRenderer {
	return &HookRenderer{mdRenderer: mdRenderer, outputFormat: outputFormat}
}

func (hr *HookRenderer) RenderHookStatus(h types.HookMessage) string {
	statusText := strings.TrimSpace(h.Status)
	if statusText == "" {
		statusText = "unknown"
	}

	// Header: aligned with ToolRenderer’s phrasing so transcripts scan consistently.
	// Example: "### Cline hook completed: PreToolUse (tool: read_file) (exit 0)"
	var headerBuilder strings.Builder
	headerBuilder.WriteString(fmt.Sprintf("### Cline hook %s: %s", statusText, h.HookName))
	if h.ToolName != "" {
		headerBuilder.WriteString(" ")
		headerBuilder.WriteString(fmt.Sprintf("(tool: %s)", h.ToolName))
	}
	if statusText == "failed" && h.ExitCode != 0 {
		headerBuilder.WriteString(" ")
		headerBuilder.WriteString(fmt.Sprintf("(exit %d)", h.ExitCode))
	}
	header := headerBuilder.String()

	var lines []string
	lines = append(lines, header)

	// Pending tool info (PreToolUse): show one high-signal line directly under the header.
	if h.PendingToolInfo != nil {
		if pending := hr.formatPendingToolInfo(h.PendingToolInfo); pending != "" {
			lines = append(lines, fmt.Sprintf("- Pending: %s", pending))
		}
	}

	// Script paths: one per line.
	paths := make([]string, 0, len(h.ScriptPaths))
	for _, p := range h.ScriptPaths {
		p = strings.TrimSpace(p)
		if p != "" {
			paths = append(paths, p)
		}
	}

	if len(paths) == 0 {
		// Fallback when no script paths are provided.
		lines = append(lines, "- *(no hook scripts found)*")
	} else {
		for _, p := range paths {
			lines = append(lines, fmt.Sprintf("- Running hook: `%s`", p))
		}
	}

	// On failure, show a minimal summary (full stderr reserved for verbose).
	if statusText == "failed" && h.Error != nil {
		if msg := strings.TrimSpace(h.Error.Message); msg != "" {
			lines = append(lines, fmt.Sprintf("- Error: %s", msg))
		}
		// If we have a specific script path, include it as a hint.
		if sp := strings.TrimSpace(h.Error.ScriptPath); sp != "" {
			lines = append(lines, fmt.Sprintf("- Script: `%s`", sp))
		}
	}

	markdown := strings.Join(lines, "\n")
	return hr.renderMarkdown(markdown)
}

func (hr *HookRenderer) formatPendingToolInfo(info *types.ToolInfo) string {
	if info == nil {
		return ""
	}
	tool := strings.TrimSpace(info.Tool)
	if tool == "" {
		return ""
	}

	// Keep this intentionally compact and readable.
	// Format: "<tool> <identifier>" where identifier is the most relevant param.
	var ident string
	switch {
	case strings.TrimSpace(info.Path) != "":
		ident = strings.TrimSpace(info.Path)
	case strings.TrimSpace(info.Command) != "":
		ident = strings.TrimSpace(info.Command)
	case strings.TrimSpace(info.Url) != "":
		ident = strings.TrimSpace(info.Url)
	case strings.TrimSpace(info.McpTool) != "" && strings.TrimSpace(info.McpServer) != "":
		ident = fmt.Sprintf("%s %s", strings.TrimSpace(info.McpServer), strings.TrimSpace(info.McpTool))
	case strings.TrimSpace(info.ResourceUri) != "":
		ident = strings.TrimSpace(info.ResourceUri)
	case strings.TrimSpace(info.Regex) != "":
		ident = strings.TrimSpace(info.Regex)
	default:
		ident = ""
	}

	if ident != "" {
		return fmt.Sprintf("%s %s", tool, ident)
	}
	return tool
}

func (hr *HookRenderer) renderMarkdown(markdown string) string {
	// Align with ToolRenderer: in plain mode or non-TTY, return markdown as-is.
	if hr.outputFormat == "plain" || !isTTY() {
		return markdown
	}
	if hr.mdRenderer == nil {
		return markdown
	}
	rendered, err := hr.mdRenderer.Render(markdown)
	if err != nil {
		return markdown
	}
	return rendered
}
