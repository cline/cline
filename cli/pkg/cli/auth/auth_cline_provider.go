package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
)

var isSessionAuthenticated bool

// Cline provider specific code

func HandleClineAuth(ctx context.Context) error {
	fmt.Println("Authenticating with Cline...")

	// Check if already authenticated
	if IsAuthenticated(ctx) {
		return signOutDialog(ctx)
	}

	// Perform sign in
	if err := signIn(ctx); err != nil {
		return err
	}

	fmt.Println("✓ You are signed in!")

	// Configure default Cline model after successful authentication
	if err := configureDefaultClineModel(ctx); err != nil {
		fmt.Printf("Warning: Could not configure default Cline model: %v\n", err)
		fmt.Println("You can configure a model later with 'cline auth' and selecting 'Change Cline model'")
	}

	// Return to main auth menu after successful authentication
	return HandleAuthMenuNoArgs(ctx)
}

func signOut(ctx context.Context) error {
	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		return err
	}

	if _, err = client.Account.AccountLogoutClicked(ctx, &cline.EmptyRequest{}); err != nil {
		return err
	}

	isSessionAuthenticated = false
	fmt.Println("You have been signed out of Cline.")
	return nil
}

func signOutDialog(ctx context.Context) error {
	var confirm bool
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("You are already signed in to Cline.").
				Description("Would you like to sign out?").
				Value(&confirm),
		),
	)

	if err := form.Run(); err != nil {
		return nil
	}

	if confirm {
		if err := signOut(ctx); err != nil {
			fmt.Printf("Failed to sign out: %v\n", err)
			return err
		}
	}
	return HandleAuthMenuNoArgs(ctx)
}

func signIn(ctx context.Context) error {
	if IsAuthenticated(ctx) {
		return nil
	}

	verboseLog("Ensuring default instance exists...")
	if err := global.EnsureDefaultInstance(ctx); err != nil {
		verboseLog("Failed to ensure default instance: %v", err)
		return fmt.Errorf("failed to ensure default instance: %w", err)
	}

	verboseLog("Default instance ensured successfully.")
	time.Sleep(2 * time.Second) // Allow services to start

	// Subscribe to auth updates before initiating login
	verboseLog("Subscribing to auth status updates...")
	listener, err := NewAuthStatusListener(ctx)
	if err != nil {
		verboseLog("Failed to subscribe to auth updates: %v", err)
		return fmt.Errorf("failed to subscribe to auth updates: %w", err)
	}
	defer listener.Stop()

	if err := listener.Start(); err != nil {
		verboseLog("Failed to start auth listener: %v", err)
		return fmt.Errorf("failed to start auth listener: %w", err)
	}

	// Initiate login (opens browser with callback URL from cline-core's AuthHandler)
	verboseLog("Initiating login...")
	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		verboseLog("Failed to obtain client: %v", err)
		return fmt.Errorf("failed to obtain client: %w", err)
	}

	_, err = client.Account.AccountLoginClicked(ctx, &cline.EmptyRequest{})
	if err != nil {
		verboseLog("Failed to initiate login: %v", err)
		return fmt.Errorf("failed to initiate login: %w", err)
	}

	fmt.Println("\n  Opening browser for authentication...")
	fmt.Println("  Waiting for you to complete authentication in your browser...")
	fmt.Println("   (This may take a few moments. Timeout: 5 minutes)")

	// Wait for auth status update confirming success
	verboseLog("Waiting for authentication to complete...")
	if err := listener.WaitForAuthentication(5 * time.Minute); err != nil {
		verboseLog("Authentication failed or timed out: %v", err)
		fmt.Println("\n  Authentication failed or timed out.")
		fmt.Println("  Please try again with 'cline auth'")
		return err
	}

	// Only NOW set the session flag after confirmed authentication
	isSessionAuthenticated = true
	verboseLog("Login successful")
	return nil
}

func IsAuthenticated(ctx context.Context) bool {
	if isSessionAuthenticated {
		verboseLog("Session is already authenticated")
		return true
	}

	verboseLog("Verifying authentication with server...")
	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		verboseLog("Failed to get client for auth check: %v", err)
		return false
	}

	_, err = client.Account.GetUserCredits(ctx, &cline.EmptyRequest{})
	if err == nil {
		// Update session variable for future fast-path checks
		verboseLog("Server verification successful, updating session flag")
		isSessionAuthenticated = true
		return true
	}

	verboseLog("Server verification failed: %v", err)
	return false
}

// HandleChangeClineModel allows Cline-authenticated users to change their Cline model selection. Hidden when not authenticated.
func HandleChangeClineModel(ctx context.Context) error {
	// Ensure user is authenticated
	if !IsAuthenticated(ctx) {
		return fmt.Errorf("you must be authenticated with Cline to change models. Run 'cline auth' to sign in")
	}

	// Get task manager
	manager, err := createTaskManager(ctx)
	if err != nil {
		return fmt.Errorf("failed to create task manager: %w", err)
	}

	// Launch Cline model selection
	return SelectClineModel(ctx, manager)
}

// configureDefaultClineModel configures the default Cline model after authentication
func configureDefaultClineModel(ctx context.Context) error {
	verboseLog("Configuring default Cline model...")

	// Create task manager
	manager, err := task.NewManagerForDefault(ctx)
	if err != nil {
		return fmt.Errorf("failed to create task manager: %w", err)
	}

	// Set default Cline model
	return SetDefaultClineModel(ctx, manager)
}
