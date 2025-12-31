package display

import (
	"testing"

	"github.com/cline/cli/pkg/cli/types"
)

func TestStreamingSegment_generateRichHeader_HookIsEmpty(t *testing.T) {
	ss := &StreamingSegment{
		sayType: string(types.SayTypeHookStatus),
		prefix:  "HOOK",
		msg:     &types.ClineMessage{},
	}

	header := ss.generateRichHeader()
	if header != "" {
		t.Fatalf("expected empty header for hook segments to avoid double-render, got: %q", header)
	}
}
