package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/cline"
)

var isSessionAuthenticated bool

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

	fmt.Println("You are signed in!")
	return nil
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
	return nil
}

func signIn(ctx context.Context) error {
	if IsAuthenticated(ctx) {
		return nil
	}

	verboseLog("Ensuring default instance exists...")
	if err := global.EnsureDefaultInstance(ctx); err != nil {
		verboseLog("Failed to ensure default instance: %v", err)
		return err
	}

	verboseLog("Default instance ensured successfully.")
	time.Sleep(2 * time.Second) // Allow services to start

	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		verboseLog("Failed to obtain client: %v", err)
		return err
	}

	_, err = client.Account.AccountLoginClicked(ctx, &cline.EmptyRequest{})
	if err != nil {
		verboseLog("Failed to login: %v", err)
		return err
	}

	isSessionAuthenticated = true
	verboseLog("Login successful")
	return nil
}

func IsAuthenticated(ctx context.Context) bool {
	if isSessionAuthenticated {
		return true
	}

	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		return false
	}

	_, err = client.Account.GetUserCredits(ctx, &cline.EmptyRequest{})
	return err == nil
}

func verboseLog(format string, args ...interface{}) {
	if global.Config != nil && global.Config.Verbose {
		fmt.Printf("[VERBOSE] "+format+"\n", args...)
	}
}
