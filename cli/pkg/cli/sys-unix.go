//go:build !windows

package cli

import (
	"context"
	"syscall"

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

	// Kill the process
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		return killResult{address: address, pid: pid, err: err}
	}

	return killResult{address: address, pid: pid, err: nil}
}