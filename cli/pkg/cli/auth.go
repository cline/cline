package cli

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/cline"
	"github.com/spf13/cobra"
)

var isSessionAuthenticated bool

func NewAuthCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "auth",
		Short: "Sign in to Cline",
		Long:  `Complete the authentication flow in browser to sign in to Cline.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return handleAuthCommand(cmd.Context())
		},
	}
}

func handleAuthCommand(ctx context.Context) error {
	fmt.Print("Authenticating with Cline...\n")
	if IsAuthenticated(ctx) {
		return signOutDialog(ctx)
	}

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
	fmt.Print("You are already signed in to Cline.\nWould you like to sign out? (y/N): ")

	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		return nil
	}

	response := strings.ToLower(strings.TrimSpace(scanner.Text()))
	if response == "y" || response == "yes" {
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
	if err := ensureDefaultInstance(ctx); err != nil {
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
