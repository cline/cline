package hostbridge

import (
	"context"
	"fmt"
	"log"
	"net"

	"github.com/cline/grpc-go/host"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
)

// GrpcServer provides gRPC hostbridge functionality
type GrpcServer struct {
	port       int
	verbose    bool
	workspaces []string
	server     *grpc.Server
	shutdownCh chan struct{}
}

// NewGrpcServer creates a new GrpcServer
func NewGrpcServer(port int, verbose bool, workspaces []string) *GrpcServer {
	return &GrpcServer{
		port:       port,
		verbose:    verbose,
		workspaces: workspaces,
		shutdownCh: make(chan struct{}),
	}
}

// Start starts the gRPC hostbridge server
func (s *GrpcServer) Start(ctx context.Context) error {
	if s.verbose {
		log.Printf("Starting gRPC hostbridge server on port %d", s.port)
	}

	// Create listener
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %w", s.port, err)
	}

	// Create gRPC server
	s.server = grpc.NewServer()

	// Register health service
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	grpc_health_v1.RegisterHealthServer(s.server, healthServer)

	// Register services
	workspaceService := NewSimpleWorkspaceService(s.verbose, s.workspaces)
	host.RegisterWorkspaceServiceServer(s.server, workspaceService)

	windowService := NewWindowService(s.verbose)
	host.RegisterWindowServiceServer(s.server, windowService)

	diffService := NewDiffService(s.verbose)
	host.RegisterDiffServiceServer(s.server, diffService)

	envService := NewEnvService(s.verbose)
	host.RegisterEnvServiceServer(s.server, envService)

	if s.verbose {
		log.Printf("Registered HealthService")
		log.Printf("Registered WorkspaceService")
		log.Printf("Registered WindowService")
		log.Printf("Registered DiffService")
		log.Printf("Registered EnvService")
	}

	// Start server in goroutine
	go func() {
		if s.verbose {
			log.Printf("gRPC server listening on :%d", s.port)
		}
		if err := s.server.Serve(lis); err != nil {
			log.Printf("gRPC server error: %v", err)
		}
	}()

	// Wait for context cancellation or global shutdown signal
	select {
	case <-ctx.Done():
		if s.verbose {
			log.Println("Context cancelled, shutting down gRPC hostbridge server...")
		}
	case <-globalShutdownCh:
		if s.verbose {
			log.Println("Shutdown requested via RPC, shutting down gRPC hostbridge server...")
		}
	}

	// Graceful shutdown
	s.server.GracefulStop()

	if s.verbose {
		log.Println("gRPC hostbridge server stopped")
	}

	return nil
}

// TriggerShutdown triggers a graceful shutdown of the server
func (s *GrpcServer) TriggerShutdown() {
	select {
	case s.shutdownCh <- struct{}{}:
		// Shutdown signal sent
	default:
		// Channel already has a signal or is closed
	}
}
