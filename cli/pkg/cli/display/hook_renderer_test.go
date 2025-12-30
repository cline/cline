package display

import (
	"strings"
	"testing"

	"github.com/cline/cli/pkg/cli/types"
)

func TestHookRenderer_RenderHookStatus_FailedShowsErrorAndScript(t *testing.T) {
	hr := NewHookRenderer(nil, "plain")

	msg := hr.RenderHookStatus(types.HookMessage{
		HookName:    "PreToolUse",
		ToolName:    "execute_command",
		Status:      "failed",
		ExitCode:    2,
		ScriptPaths: []string{"repo/.clinerules/hooks/PreToolUse"},
		Error: &types.HookError{
			Message:    "boom",
			ScriptPath: "repo/.clinerules/hooks/PreToolUse",
		},
	})

	if !strings.Contains(msg, "### Cline hook failed: PreToolUse") {
		t.Fatalf("expected header in rendered output, got: %q", msg)
	}
	if !strings.Contains(msg, "- Error: boom") {
		t.Fatalf("expected error line in rendered output, got: %q", msg)
	}
	if !strings.Contains(msg, "- Script: `repo/.clinerules/hooks/PreToolUse`") {
		t.Fatalf("expected script line in rendered output, got: %q", msg)
	}
}
