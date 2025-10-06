package hostbridge

import (
	"context"
	"log"

	"github.com/cline/grpc-go/cline"
	"github.com/cline/grpc-go/host"
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
		log.Printf("ClipboardWriteText called with: %s", req.GetValue())
	}

	// TODO: Implement actual clipboard functionality
	// For now, just return success
	return &cline.Empty{}, nil
}

// ClipboardReadText reads text from the system clipboard
func (s *EnvService) ClipboardReadText(ctx context.Context, req *cline.EmptyRequest) (*cline.String, error) {
	if s.verbose {
		log.Printf("ClipboardReadText called")
	}

	// TODO: Implement actual clipboard functionality
	// For now, return empty string
	return &cline.String{
		Value: "",
	}, nil
}

// GetMachineId returns a stable machine identifier for telemetry distinctId purposes
func (s *EnvService) GetMachineId(ctx context.Context, req *cline.EmptyRequest) (*cline.String, error) {
	if s.verbose {
		log.Printf("GetMachineId called")
	}

	// TODO: Implement actual machine ID functionality
	// For now, return empty string
	return &cline.String{
		Value: "",
	}, nil
}

// GetHostVersion returns the host platform name and version
func (s *EnvService) GetHostVersion(ctx context.Context, req *cline.EmptyRequest) (*host.GetHostVersionResponse, error) {
	if s.verbose {
		log.Printf("GetHostVersion called")
	}

	// TODO: Implement actual host version functionality
	// For now, return empty response
	return &host.GetHostVersionResponse{}, nil
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
