package hostbridge

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/atotto/clipboard"
	"github.com/cline/cli/pkg/cli"
	"github.com/cline/grpc-go/cline"
	"github.com/cline/grpc-go/host"
	"github.com/google/uuid"
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
		// Just log and return success
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

// getMachineIdPath returns the path to the machine ID file
func getMachineIdPath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(homeDir, ".cline", "machine-id"), nil
}

// GetMachineId returns a stable machine identifier for telemetry distinctId purposes
func (s *EnvService) GetMachineId(ctx context.Context, req *cline.EmptyRequest) (*cline.String, error) {
	if s.verbose {
		log.Printf("GetMachineId called")
	}

	idPath, err := getMachineIdPath()
	if err != nil {
		if s.verbose {
			log.Printf("Failed to get machine ID path: %v", err)
		}
		return &cline.String{Value: ""}, nil
	}

	// Try to read existing machine ID
	if data, err := os.ReadFile(idPath); err == nil {
		id := strings.TrimSpace(string(data))
		if id != "" {
			if s.verbose {
				log.Printf("Using existing machine ID: %s", id)
			}
			return &cline.String{Value: id}, nil
		}
	}

	// Generate new machine ID
	id := uuid.New().String()
	if s.verbose {
		log.Printf("Generated new machine ID: %s", id)
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(idPath), 0755); err != nil {
		if s.verbose {
			log.Printf("Failed to create .cline directory: %v", err)
		}
		// Still return the ID even if we can't save it
		return &cline.String{Value: id}, nil
	}

	// Try to save the machine ID for future use
	if err := os.WriteFile(idPath, []byte(id), 0644); err != nil {
		if s.verbose {
			log.Printf("Failed to save machine ID: %v", err)
		}
		// Still return the ID even if we can't save it
	}

	return &cline.String{Value: id}, nil
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
		ClineVersion: proto.String(cli.Version),
	}, nil
}

// GetIdeRedirectUri returns a URI that will redirect to the host environment
func (s *EnvService) GetIdeRedirectUri(ctx context.Context, req *cline.EmptyRequest) (*cline.String, error) {
	if s.verbose {
		log.Printf("GetIdeRedirectUri called")
	}

	// CLI does not have a URI scheme
	return &cline.String{Value: ""}, nil
}

// GetTelemetrySettings returns the telemetry settings of the host environment
func (s *EnvService) GetTelemetrySettings(ctx context.Context, req *cline.EmptyRequest) (*host.GetTelemetrySettingsResponse, error) {
	if s.verbose {
		log.Printf("GetTelemetrySettings called")
	}

	// CLI does not have its own telemetry settings
	return &host.GetTelemetrySettingsResponse{
		IsEnabled: host.Setting_UNSUPPORTED,
	}, nil
}

// SubscribeToTelemetrySettings returns events when the telemetry settings change
func (s *EnvService) SubscribeToTelemetrySettings(req *cline.EmptyRequest, stream host.EnvService_SubscribeToTelemetrySettingsServer) error {
	if s.verbose {
		log.Printf("SubscribeToTelemetrySettings called")
	}

	// CLI does not have telemetry settings changes to stream
	// Just return without sending any events (empty stream)
	return nil
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
