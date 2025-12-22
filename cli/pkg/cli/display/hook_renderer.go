package display

import (
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/types"
)

// HookRenderer provides consistent, CLI-native rendering for hook status messages.
//
// Design goals:
// - Match the look/feel of existing CLI output (markdown headers like ToolRenderer)
// - Keep each hook execution as a separate entry (no grouping)
// - Do not render hook output streaming (hook_output_stream) in this iteration
//
// Note: This renderer returns markdown strings. The caller should print the result
// via output.Print / output.Printf after passing through the markdown renderer.
// We use the same strategy as ToolRenderer: render markdown when possible, fallback
// to plaintext when markdown rendering is disabled.

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
	
	// Build header: "### Hook <status>: <HookName> (tool: <ToolName>) (exit <code>)"
	headerParts := []string{fmt.Sprintf("### Hook triggered: %s", h.HookName)}
	if h.ToolName != "" {
		headerParts = append(headerParts, fmt.Sprintf("(tool: %s)", h.ToolName))
	}
	if statusText == "failed" && h.ExitCode != 0 {
		headerParts = append(headerParts, fmt.Sprintf("(exit %d)", h.ExitCode))
	}
	header := strings.Join(headerParts, " ")

	var lines []string
	lines = append(lines, header)

	// Paths: keep it readable without verbose; list each path on its own line.
	// If a single script, render a single italic line.
	// If multiple scripts, render "*N scripts*" then bullet list.
	paths := make([]string, 0, len(h.ScriptPaths))
	for _, p := range h.ScriptPaths {
		p = strings.TrimSpace(p)
		if p != "" {
			paths = append(paths, p)
		}
	}

	for _, p := range paths {
		lines = append(lines, fmt.Sprintf("- Running hook: `%s`", p))
	}

	markdown := strings.Join(lines, "\n")
	return hr.renderMarkdown(markdown)
}

func (hr *HookRenderer) renderMarkdown(markdown string) string {
	// Keep behavior aligned with ToolRenderer: if plain mode or not TTY,
	// caller will just get markdown as-is.
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
