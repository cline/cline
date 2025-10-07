package config

import (
	"context"
	"fmt"

	"github.com/cline/grpc-go/client"
	"github.com/cline/grpc-go/cline"
)

// UpdateSettings sends a settings update request to Cline Core via gRPC.
// This function provides a thin wrapper around the StateService.UpdateSettings endpoint,
// allowing configuration changes to be persisted to Cline Core's storage
// (~/.cline/data/globalState.json and ~/.cline/data/secrets.json).
//
// Parameters:
//   - ctx: Context for cancellation and timeouts
//   - client: Active gRPC client connection to Cline Core
//   - request: Complete settings update request with all configurations
//
// Returns:
//   - error: Non-nil if the settings update fails
func UpdateSettings(ctx context.Context, client *client.ClineClient, request *cline.UpdateSettingsRequest) error {
	// Call the gRPC endpoint
	_, err := client.State.UpdateSettings(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to update settings: %w", err)
	}

	return nil
}
