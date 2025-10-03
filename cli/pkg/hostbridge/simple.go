package hostbridge

import (
	"context"
	"fmt"
	"log"
)

// Simple implementations that don't rely on proto files for now
// This allows us to test the basic hostbridge structure

// SimpleService provides basic hostbridge functionality
type SimpleService struct {
	coreAddress string
	verbose     bool
}

// NewSimpleService creates a new SimpleService
func NewSimpleService(coreAddress string, verbose bool) *SimpleService {
	return &SimpleService{
		coreAddress: coreAddress,
		verbose:     verbose,
	}
}

// Start starts the simple hostbridge service
func (s *SimpleService) Start(ctx context.Context) error {
	if s.verbose {
		log.Printf("Starting simple hostbridge service (connecting to core at %s)", s.coreAddress)
	}

	// For now, just log that we're running
	fmt.Printf("[Cline Host Bridge] Service started on core address: %s\n", s.coreAddress)

	// Keep running until context is cancelled
	<-ctx.Done()

	if s.verbose {
		log.Println("Simple hostbridge service stopped")
	}

	return nil
}
