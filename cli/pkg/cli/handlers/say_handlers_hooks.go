package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/cli/types"
)

// Hook-specific SAY handlers and helpers.
// Kept in a separate file to keep say_handlers.go focused on routing.

// handleHookStatus handles hook execution status messages.
func (h *SayHandler) handleHookStatus(msg *types.ClineMessage, dc *DisplayContext) error {
	hook, err := parseHookMessage(msg.Text)
	if err != nil {
		// Fallback to basic output if JSON parsing fails
		return dc.Renderer.RenderMessage("HOOK", msg.Text, true)
	}

	logHookDebug(hook, dc)
	hook.ScriptPaths = formatHookPaths(hook.ScriptPaths)

	return renderHookStatus(hook, dc)
}

// handleHookOutputStream handles streaming output from hooks.
//
// Hook stdout/stderr currently arrives line-by-line from the backend as
// `hook_output_stream` messages. The CLI intentionally suppresses these by default
// to keep the transcript high-signal.
//
// In --verbose mode, we print each non-empty line prefixed with "HOOK>" for easy grepping.
// Future work could associate these lines with a specific hook execution and render them
// as a grouped section under the hook status header.
func (h *SayHandler) handleHookOutputStream(msg *types.ClineMessage, dc *DisplayContext) error {
	if !dc.Verbose {
		return nil
	}

	line := strings.TrimRight(msg.Text, "\n")
	if strings.TrimSpace(line) == "" {
		return nil
	}

	output.Printf("HOOK> %s\n", line)
	return nil
}

func parseHookMessage(jsonText string) (types.HookMessage, error) {
	var hook types.HookMessage
	if err := json.Unmarshal([]byte(jsonText), &hook); err != nil {
		return types.HookMessage{}, err
	}
	return hook, nil
}

func logHookDebug(hook types.HookMessage, dc *DisplayContext) {
	if dc.Verbose {
		output.Printf("[DEBUG] Hook parsed: name=%s, status=%s, toolName=%s, scriptPaths=%v\n",
			hook.HookName, hook.Status, hook.ToolName, hook.ScriptPaths)
	}
}

func formatHookPaths(paths []string) []string {
	if len(paths) == 0 {
		return paths
	}
	formatted := make([]string, 0, len(paths))
	for _, p := range paths {
		if strings.TrimSpace(p) == "" {
			continue
		}
		formatted = append(formatted, formatHookPath(p))
	}
	return formatted
}

func renderHookStatus(hook types.HookMessage, dc *DisplayContext) error {
	if dc.HookRenderer != nil {
		rendered := dc.HookRenderer.RenderHookStatus(hook)
		// Match ToolRenderer’s spacing: one leading newline, one trailing newline.
		output.Print("\n")
		output.Print(rendered)
		output.Print("\n")
		return nil
	}

	// Fallback: if HookRenderer not available
	return dc.Renderer.RenderMessage("HOOK", fmt.Sprintf("%s %s", hook.HookName, hook.Status), true)
}

func formatHookPath(fullPath string) string {
	// Normalize for display and prefix checks. This is display-only; do not use for IO.
	normalized := normalizeSlashes(fullPath)

	// If this is a repo-scoped hook script (i.e. lives under <repo>/.clinerules/hooks/),
	// always include the repo name for disambiguation even in single-repo workspaces.
	//
	// This intentionally runs before workspace-relative formatting, which would otherwise
	// collapse to ".clinerules/hooks/..." and lose the repo context.
	if p, ok := tryRepoScopedHooksPath(normalized); ok {
		return p
	}

	// Prefer workspace-relative paths first for readability, since most hook scripts
	// live inside the current project.
	if p, ok := tryWorkspaceRelativeHookPath(normalized); ok {
		return p
	}

	// Follow existing CLI pattern: resolve home via os.UserHomeDir.
	if p, ok := tryHomeTildePath(normalized); ok {
		return p
	}

	// Secondary heuristic: if hook lives under <repo>/.clinerules, collapse to repo-relative.
	if p, ok := tryRepoRelativeHookPath(normalized); ok {
		return p
	}

	return fallbackLastComponents(normalized, 3)
}

func normalizeSlashes(p string) string {
	return filepath.ToSlash(p)
}

func tryWorkspaceRelativeHookPath(normalizedPath string) (string, bool) {
	root, err := os.Getwd()
	if err != nil {
		return "", false
	}
	
	// filepath.Rel expects OS-native paths, so we need to convert the normalized path
	// back to OS-native format before calling Rel, then normalize the result for display.
	targetOS := filepath.FromSlash(normalizedPath)
	rel, err := filepath.Rel(root, targetOS)
	if err != nil {
		return "", false
	}
	// If it's not within the workspace, Rel will start with "..".
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return normalizeSlashes(rel), true
}

func tryHomeTildePath(normalizedPath string) (string, bool) {
	homeDir, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(homeDir) == "" {
		return "", false
	}
	homeDir = normalizeSlashes(homeDir)
	if !strings.HasPrefix(normalizedPath, homeDir) {
		return "", false
	}
	rel := strings.TrimPrefix(normalizedPath, homeDir)
	rel = strings.TrimPrefix(rel, "/")
	return "~/" + rel, true
}

func tryRepoRelativeHookPath(normalizedPath string) (string, bool) {
	parts := strings.Split(normalizedPath, "/")
	for i, part := range parts {
		if part == ".clinerules" && i > 0 {
			repoName := parts[i-1]
			return repoName + "/" + strings.Join(parts[i:], "/"), true
		}
	}
	return "", false
}

// tryRepoScopedHooksPath returns a repo-prefixed path like
// "myrepo/.clinerules/hooks/PreToolUse" when the given path points to a hook script
// under a repo's .clinerules/hooks directory.
//
// This is more specific than tryRepoRelativeHookPath and is used to ensure hook script
// paths always include repo context.
func tryRepoScopedHooksPath(normalizedPath string) (string, bool) {
	// Fast path check to avoid split work.
	if !strings.Contains(normalizedPath, "/.clinerules/hooks/") {
		return "", false
	}
	return tryRepoRelativeHookPath(normalizedPath)
}

func fallbackLastComponents(normalizedPath string, n int) string {
	parts := strings.Split(normalizedPath, "/")
	if len(parts) >= n {
		return strings.Join(parts[len(parts)-n:], "/")
	}
	return normalizedPath
}
