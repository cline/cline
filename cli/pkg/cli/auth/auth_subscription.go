package auth

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/cline"
)

// AuthStatusListener manages subscription to auth status updates
type AuthStatusListener struct {
	stream    cline.AccountService_SubscribeToAuthStatusUpdateClient
	updatesCh chan *cline.AuthState
	errCh     chan error
	ctx       context.Context
	cancel    context.CancelFunc
}

// NewAuthStatusListener creates a new auth status listener
func NewAuthStatusListener(parentCtx context.Context) (*AuthStatusListener, error) {
	client, err := global.GetDefaultClient(parentCtx)
	if err != nil {
		return nil, fmt.Errorf("failed to get client: %w", err)
	}

	// Create cancellable context
	ctx, cancel := context.WithCancel(parentCtx)

	// Subscribe to auth status updates
	stream, err := client.Account.SubscribeToAuthStatusUpdate(ctx, &cline.EmptyRequest{})
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to subscribe to auth updates: %w", err)
	}

	return &AuthStatusListener{
		stream:    stream,
		updatesCh: make(chan *cline.AuthState, 10),
		errCh:     make(chan error, 1),
		ctx:       ctx,
		cancel:    cancel,
	}, nil
}

// Start begins listening to the auth status update stream
func (l *AuthStatusListener) Start() error {
	verboseLog("Starting auth status listener...")

	go l.readStream()

	return nil
}

// readStream reads from the gRPC stream and forwards messages to channels
func (l *AuthStatusListener) readStream() {
	defer close(l.updatesCh)
	defer close(l.errCh)

	for {
		select {
		case <-l.ctx.Done():
			verboseLog("Auth listener context cancelled")
			return
		default:
			state, err := l.stream.Recv()
			if err != nil {
				if err == io.EOF {
					verboseLog("Auth status stream closed")
					return
				}
				verboseLog("Error reading from auth status stream: %v", err)
				select {
				case l.errCh <- err:
				case <-l.ctx.Done():
				}
				return
			}

			verboseLog("Received auth state update: user=%v", state.User != nil)

			select {
			case l.updatesCh <- state:
			case <-l.ctx.Done():
				return
			}
		}
	}
}

// WaitForAuthentication blocks until authentication succeeds or timeout occurs
func (l *AuthStatusListener) WaitForAuthentication(timeout time.Duration) error {
	verboseLog("Waiting for authentication (timeout: %v)...", timeout)

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case <-timer.C:
			return fmt.Errorf("authentication timeout after %v - please try again", timeout)

		case <-l.ctx.Done():
			return fmt.Errorf("authentication cancelled")

		case err := <-l.errCh:
			return fmt.Errorf("authentication stream error: %w", err)

		case state := <-l.updatesCh:
			if isAuthenticated(state) {
				verboseLog("Authentication successful!")
				return nil
			}
			verboseLog("Received auth update but not authenticated yet...")
		}
	}
}

// Stop closes the stream and cleans up resources
func (l *AuthStatusListener) Stop() {
	verboseLog("Stopping auth status listener...")
	l.cancel()
}

// isAuthenticated checks if AuthState indicates successful authentication
func isAuthenticated(state *cline.AuthState) bool {
	return state != nil && state.User != nil
}
