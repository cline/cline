package auth

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// OcaConfig holds Oracle Code Assist (OCA) configuration fields
type OcaConfig struct {
	BaseURL string
	Mode    string
}

// PromptForOcaConfig displays a form for OCA configuration (base URL and mode)
func PromptForOcaConfig(ctx context.Context, manager *task.Manager) (*OcaConfig, error) {
	config := &OcaConfig{}
	var mode string

	// Collect optional settings
	configForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Base URL").
				Value(&config.BaseURL).
				Description("Leave empty to use default Base URL"),

			huh.NewSelect[string]().
				Title("Choose OCA mode (used for authentication)").
				Description("Select 'Internal' to use Cline's internal OCA, or 'External' for your own OCA instance").
				Options(
					huh.NewOption("Internal", "internal"),
					huh.NewOption("External", "external"),
				).
				Value(&mode),
		),
	)

	if err := configForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get OCA configuration: %w", err)
	}

	// Trim whitespace from string fields
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	config.Mode = strings.TrimSpace(mode)

	return config, nil
}

// ApplyOcaConfig applies OCA configuration using partial updates
func ApplyOcaConfig(ctx context.Context, manager *task.Manager, config *OcaConfig) error {
	// Build the API configuration with all OCA fields
	apiConfig := &cline.ModelsApiConfiguration{}

	// Set profile authentication fields (always required)
	optionalFields := &OcaOptionalFields{}

	// Set profile name (can be empty for default profile)
	if config.BaseURL != "" {
		optionalFields.BaseURL = proto.String(config.BaseURL)
	}

	// Set optional fields if provided
	if config.Mode != "" {
		optionalFields.Mode = proto.String(config.Mode)
	}

	// Apply all fields to the config
	setOcaOptionalFields(apiConfig, optionalFields)

	// Add profile authentication field paths
	optionalPaths := buildOcaOptionalFieldMask(optionalFields)

	// Create field mask
	fieldMask := &fieldmaskpb.FieldMask{Paths: optionalPaths}

	// Apply the partial update
	request := &cline.UpdateApiConfigurationPartialRequest{
		ApiConfiguration: apiConfig,
		UpdateMask:       fieldMask,
	}

	if err := updateApiConfigurationPartial(ctx, manager, request); err != nil {
		return fmt.Errorf("failed to apply OCA configuration: %w", err)
	}

	return nil
}

// ===========================
// OCA Auth Listener Singleton
// ===========================

type ocaAuthStream interface {
	Recv() (*cline.OcaAuthState, error)
}

// OcaAuthStatusListener manages subscription to OCA auth status updates
type OcaAuthStatusListener struct {
	stream        ocaAuthStream
	updatesCh     chan *cline.OcaAuthState
	errCh         chan error
	ctx           context.Context
	cancel        context.CancelFunc
	mu            sync.RWMutex
	lastState     *cline.OcaAuthState
	firstEventCh  chan struct{}
	firstEventOnce sync.Once
}

// NewOcaAuthStatusListener creates a new OCA auth status listener
func NewOcaAuthStatusListener(parentCtx context.Context) (*OcaAuthStatusListener, error) {
	client, err := global.GetDefaultClient(parentCtx)
	if err != nil {
		return nil, fmt.Errorf("failed to get client: %w", err)
	}

	// Keep the listener alive independently of short-lived caller contexts
	ctx, cancel := context.WithCancel(context.Background())

	// Subscribe to OCA auth status updates
	stream, err := client.Ocaaccount.OcaSubscribeToAuthStatusUpdate(ctx, &cline.EmptyRequest{})
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to subscribe to OCA auth updates: %w", err)
	}

	return &OcaAuthStatusListener{
		stream:       stream,
		updatesCh:    make(chan *cline.OcaAuthState, 10),
		errCh:        make(chan error, 1),
		ctx:          ctx,
		cancel:       cancel,
		firstEventCh: make(chan struct{}),
	}, nil
}

// Start begins listening to the auth status update stream
func (l *OcaAuthStatusListener) Start() error {
	go l.readStream()
	return nil
}

func (l *OcaAuthStatusListener) readStream() {
	defer close(l.updatesCh)
	defer close(l.errCh)

	for {
		select {
		case <-l.ctx.Done():
			return
		default:
			state, err := l.stream.Recv()
			if err != nil {
				// Propagate error and exit
				if err == io.EOF {
					// Treat as error to notify waiters
					err = fmt.Errorf("OCA auth status stream closed")
				}
				select {
				case l.errCh <- err:
				case <-l.ctx.Done():
				}
				return
			}

			l.mu.Lock()
			l.lastState = state
			l.mu.Unlock()

			// Notify first event waiters
			l.firstEventOnce.Do(func() { close(l.firstEventCh) })

			select {
			case l.updatesCh <- state:
			case <-l.ctx.Done():
				return
			}
		}
	}
}

// WaitForFirstEvent blocks until the first event is received or timeout occurs
func (l *OcaAuthStatusListener) WaitForFirstEvent(timeout time.Duration) error {
	// Fast-path if already have a state
	l.mu.RLock()
	ready := l.lastState != nil
	l.mu.RUnlock()
	if ready {
		return nil
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-l.firstEventCh:
		return nil
	case <-timer.C:
		return fmt.Errorf("timeout waiting for initial OCA auth event")
	case <-l.ctx.Done():
		return fmt.Errorf("OCA auth listener cancelled")
	}
}

// IsAuthenticated returns true if the last known OCA auth state is authenticated
func (l *OcaAuthStatusListener) IsAuthenticated() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return isOCAStateAuthenticated(l.lastState)
}

// WaitForAuthentication waits until OCA authentication succeeds or timeout occurs
func (l *OcaAuthStatusListener) WaitForAuthentication(timeout time.Duration) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	// If already authenticated, return immediately
	if l.IsAuthenticated() {
		return nil
	}

	for {
		select {
		case <-timer.C:
			return fmt.Errorf("OCA authentication timeout after %v - please try again", timeout)
		case <-l.ctx.Done():
			return fmt.Errorf("OCA authentication cancelled")
		case err := <-l.errCh:
			return fmt.Errorf("OCA authentication stream error: %w", err)
		case state := <-l.updatesCh:
			if isOCAStateAuthenticated(state) {
				return nil
			}
		}
	}
}

// Stop closes the stream and cleans up resources
func (l *OcaAuthStatusListener) Stop() {
	l.cancel()
}

func isOCAStateAuthenticated(state *cline.OcaAuthState) bool {
	return state != nil && state.User != nil
}

// Singleton holder
var (
	ocaListener     *OcaAuthStatusListener
	ocaListenerOnce sync.Once
	ocaListenerErr  error
)

// GetOcaAuthListener returns the OCA auth listener singleton
func GetOcaAuthListener(ctx context.Context) (*OcaAuthStatusListener, error) {
	// Allow optional ctx: if nil, use context.TODO(). If already initialized, return singleton.
	if ctx == nil {
		ctx = context.TODO()
	}

	ocaListenerOnce.Do(func() {
		l, err := NewOcaAuthStatusListener(ctx)
		if err != nil {
			ocaListenerErr = err
			return
		}
		if err := l.Start(); err != nil {
			ocaListenerErr = err
			return
		}
		ocaListener = l
	})
	return ocaListener, ocaListenerErr
}

// IsOCAAuthenticated returns true if the global OCA auth status is authenticated.
// It attempts a brief wait for the first event to avoid stale reads.
func IsOCAAuthenticated(ctx context.Context) bool {
	l, err := GetOcaAuthListener(ctx)
	if err != nil {
		return false
	}
	_ = l.WaitForFirstEvent(1 * time.Second) // best-effort
	return l.IsAuthenticated()
}

 // LatestState returns the last received OCA auth state (may be nil)
func (l *OcaAuthStatusListener) LatestState() *cline.OcaAuthState {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.lastState
}

// GetLatestOCAState returns the latest known OCA auth state, optionally waiting for the first event
func GetLatestOCAState(ctx context.Context, timeout time.Duration) (*cline.OcaAuthState, error) {
	l, err := GetOcaAuthListener(ctx)
	if err != nil {
		return nil, err
	}
	if timeout > 0 {
		if err := l.WaitForFirstEvent(timeout); err != nil {
			return nil, err
		}
	}
	return l.LatestState(), nil
}

// ensureOcaAuthenticated initiates OCA login (if needed) and waits for success using the singleton listener
func ensureOcaAuthenticated(ctx context.Context) error {
	// Ensure listener exists
	listener, err := GetOcaAuthListener(ctx)
	if err != nil {
		return fmt.Errorf("failed to initialize OCA auth listener: %w", err)
	}

	// Briefly wait for first event to know current state
	_ = listener.WaitForFirstEvent(1 * time.Second)

	// If already authenticated, nothing to do
	if listener.IsAuthenticated() {
		fmt.Println("✓ OCA authentication already active.")
		return nil
	}

	// Create gRPC client for initiating login
	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		return fmt.Errorf("failed to obtain client: %w", err)
	}

	// Start login and wait for authentication
	waitCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	// Initiate login (opens the browser with a callback URL from Cline Core)
	response, err := client.Ocaaccount.OcaAccountLoginClicked(waitCtx, &cline.EmptyRequest{})
	if err != nil {
		return fmt.Errorf("failed to initiate OCA login: %w", err)
	}

	fmt.Println("\nOpening browser for OCA authentication...")
	if response != nil && response.Value != "" {
		fmt.Printf("If the browser doesn't open automatically, visit this URL:\n%s\n\n", response.Value)
	}
	fmt.Println("Waiting for you to complete OCA authentication in your browser...")
	fmt.Println("(This may take a few moments. Timeout: 5 minutes)")

	// Block until authenticated or timeout
	if err := listener.WaitForAuthentication(5 * time.Minute); err != nil {
		return err
	}

	fmt.Println("✓ OCA authentication successful!")
	return nil
}
