package display

import (
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/types"
)

// HookRenderer renders hook status messages in a CLI-native style.
//
// Goals: match ToolRenderer’s markdown look, keep executions ungrouped, and (for now)
// don’t stream hook output.
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

	// Header: "### Hook <status>: <HookName> (tool: <ToolName>) (exit <code>)"
	headerParts := []string{fmt.Sprintf("### Hook %s: %s", statusText, h.HookName)}
	if h.ToolName != "" {
		headerParts = append(headerParts, fmt.Sprintf("(tool: %s)", h.ToolName))
	}
	if statusText == "failed" && h.ExitCode != 0 {
		headerParts = append(headerParts, fmt.Sprintf("(exit %d)", h.ExitCode))
	}
	header := strings.Join(headerParts, " ")

	var lines []string
	lines = append(lines, header)

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
