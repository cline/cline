package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/cline/cli/pkg/hostbridge"
)

var (
	port    int
	verbose bool
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "cline-host",
		Short: "Cline Host Bridge Service",
		Long:  `A simple host bridge service that provides host operations for Cline Core.`,
		RunE:  runServer,
	}

	rootCmd.Flags().IntVarP(&port, "port", "p", 51052, "port to listen on")
	rootCmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "verbose logging")

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func runServer(cmd *cobra.Command, args []string) error {
	ctx := cmd.Context()

	// Create gRPC hostbridge service
	service := hostbridge.NewGrpcServer(port, verbose)

	// Handle graceful shutdown
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		if verbose {
			log.Println("Shutting down hostbridge server...")
		}

		cancel()
	}()

	// Start server
	if verbose {
		log.Printf("Starting Cline Host Bridge on port %d", port)
	}

	// Run the service
	if err := service.Start(ctx); err != nil {
		return fmt.Errorf("failed to run service: %w", err)
	}

	return nil
}
