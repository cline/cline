//go:build windows

package cli

import (
	"context"
	"fmt"
	"os"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/cline"
)

func killInstanceProcess(ctx context.Context, registry *global.ClientRegistry, address string) killResult {
	// Get gRPC client and process info
	client, err := registry.GetClient(ctx, address)
	if err != nil {
		return killResult{address: address, alreadyDead: true, err: nil}
	}

	processInfo, err := client.State.GetProcessInfo(ctx, &cline.EmptyRequest{})
	if err != nil {
		return killResult{address: address, alreadyDead: true, err: nil}
	}

	pid := int(processInfo.ProcessId)

	// Find the process by PID
	process, err := os.FindProcess(pid)
	if err != nil {
		// Process may already be dead
		return killResult{address: address, pid: pid, alreadyDead: true, err: nil}
	}

	// Kill the process - on Windows, os.Process.Kill() calls TerminateProcess internally
	if err := process.Kill(); err != nil {
		return killResult{address: address, pid: pid, err: fmt.Errorf("failed to terminate process: %w", err)}
	}

	return killResult{address: address, pid: pid, err: nil}
}
