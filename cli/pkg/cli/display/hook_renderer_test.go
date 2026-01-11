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

func TestHookRenderer_RenderHookStatus_PendingToolInfoAppearsDirectlyUnderHeader(t *testing.T) {
	hr := NewHookRenderer(nil, "plain")

	msg := hr.RenderHookStatus(types.HookMessage{
		HookName: "PreToolUse",
		ToolName: "write_to_file",
		Status:   "running",
		PendingToolInfo: &types.ToolInfo{
			Tool: "write_to_file",
			Path: "src/foo.ts",
		},
		ScriptPaths: []string{"repo/.clinerules/hooks/PreToolUse"},
	})

	header := "### Cline hook running: PreToolUse"
	pending := "- Pending: write_to_file src/foo.ts"
	runningHook := "- Running hook: `repo/.clinerules/hooks/PreToolUse`"

	headerIdx := strings.Index(msg, header)
	if headerIdx == -1 {
		t.Fatalf("expected header %q in output, got: %q", header, msg)
	}
	pendingIdx := strings.Index(msg, pending)
	if pendingIdx == -1 {
		t.Fatalf("expected pending line %q in output, got: %q", pending, msg)
	}
	runningIdx := strings.Index(msg, runningHook)
	if runningIdx == -1 {
		t.Fatalf("expected running hook line %q in output, got: %q", runningHook, msg)
	}
	if !(headerIdx < pendingIdx && pendingIdx < runningIdx) {
		t.Fatalf("expected header < pending < runningHook ordering, got indexes header=%d pending=%d running=%d\nfull=%q", headerIdx, pendingIdx, runningIdx, msg)
	}
}
