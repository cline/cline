package hostbridge

import (
	"context"
	"log"
	"os"

	"github.com/atotto/clipboard"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/cline"
	"github.com/cline/grpc-go/host"
	"google.golang.org/protobuf/proto"
)

// Global shutdown channel - simple approach
var globalShutdownCh chan struct{}

func init() {
	globalShutdownCh = make(chan struct{})
}

// EnvService implements the host.EnvServiceServer interface
type EnvService struct {
	host.UnimplementedEnvServiceServer
	verbose bool
}

// NewEnvService creates a new EnvService
func NewEnvService(verbose bool) *EnvService {
	return &EnvService{
		verbose: verbose,
	}
}

// ClipboardWriteText writes text to the system clipboard
func (s *EnvService) ClipboardWriteText(ctx context.Context, req *cline.StringRequest) (*cline.Empty, error) {
	if s.verbose {
		log.Printf("ClipboardWriteText called with text length: %d", len(req.GetValue()))
	}

	err := clipboard.WriteAll(req.GetValue())
	if err != nil {
		if s.verbose {
			log.Printf("Failed to write to clipboard: %v", err)
		}
		// Don't fail if clipboard is not available (e.g., headless environment)
	}

	return &cline.Empty{}, nil
}

// ClipboardReadText reads text from the system clipboard
func (s *EnvService) ClipboardReadText(ctx context.Context, req *cline.EmptyRequest) (*cline.String, error) {
	if s.verbose {
		log.Printf("ClipboardReadText called")
	}

	text, err := clipboard.ReadAll()
	if err != nil {
		if s.verbose {
			log.Printf("Failed to read from clipboard: %v", err)
		}
		// Return empty string if clipboard is not available
		text = ""
	}

	return &cline.String{
		Value: text,
	}, nil
}

// GetHostVersion returns the host platform name and version
func (s *EnvService) GetHostVersion(ctx context.Context, req *cline.EmptyRequest) (*host.GetHostVersionResponse, error) {
	if s.verbose {
		log.Printf("GetHostVersion called")
	}

	return &host.GetHostVersionResponse{
		Platform:     proto.String("Cline CLI"),
		Version:      proto.String(""),
		ClineType:    proto.String("CLI"),
		ClineVersion: proto.String(global.CliVersion),
	}, nil
}

// Shutdown initiates a graceful shutdown of the host bridge service
func (s *EnvService) Shutdown(ctx context.Context, req *cline.EmptyRequest) (*cline.Empty, error) {
	if s.verbose {
		log.Printf("Shutdown requested via RPC")
	}

	// Trigger global shutdown signal
	select {
	case globalShutdownCh <- struct{}{}:
		if s.verbose {
			log.Printf("Shutdown signal sent successfully")
		}
	default:
		if s.verbose {
			log.Printf("Shutdown signal already pending")
		}
	}

	return &cline.Empty{}, nil
}

// GetTelemetrySettings returns the telemetry settings for CLI mode
func (s *EnvService) GetTelemetrySettings(ctx context.Context, req *cline.EmptyRequest) (*host.GetTelemetrySettingsResponse, error) {
	if s.verbose {
		log.Printf("GetTelemetrySettings called")
	}

	// In CLI mode, check the POSTHOG_TELEMETRY_ENABLED environment variable
	telemetryEnabled := os.Getenv("POSTHOG_TELEMETRY_ENABLED") == "true"

	var setting host.Setting
	if telemetryEnabled {
		setting = host.Setting_ENABLED
	} else {
		setting = host.Setting_DISABLED
	}

	return &host.GetTelemetrySettingsResponse{
		IsEnabled: setting,
	}, nil
}

// SubscribeToTelemetrySettings returns a stream of telemetry setting changes
// In CLI mode, telemetry settings don't change at runtime, so we just send
// the current state and keep the stream open
func (s *EnvService) SubscribeToTelemetrySettings(req *cline.EmptyRequest, stream host.EnvService_SubscribeToTelemetrySettingsServer) error {
	if s.verbose {
		log.Printf("SubscribeToTelemetrySettings called")
	}

	// Send initial telemetry state
	telemetryEnabled := os.Getenv("POSTHOG_TELEMETRY_ENABLED") == "true"

	var setting host.Setting
	if telemetryEnabled {
		setting = host.Setting_ENABLED
	} else {
		setting = host.Setting_DISABLED
	}

	event := &host.TelemetrySettingsEvent{
		IsEnabled: setting,
	}

	if err := stream.Send(event); err != nil {
		if s.verbose {
			log.Printf("Failed to send telemetry settings event: %v", err)
		}
		return err
	}

	// Keep stream open until context is cancelled
	// (In CLI mode, settings don't change dynamically)
	<-stream.Context().Done()

	if s.verbose {
		log.Printf("SubscribeToTelemetrySettings stream closed")
	}

	return nil
}
