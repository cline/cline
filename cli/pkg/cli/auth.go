package cli

import (
	"github.com/cline/cli/pkg/cli/auth"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/spf13/cobra"
)

func NewAuthCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "auth",
		Short: "Authenticate a provider and configure model used",
		Long: `Authenticate  a provider and configure model used

This command opens an interactive menu where you can:
  - Sign in to your Cline account
  - Configure other LLM providers (Anthropic, OpenAI, etc.)
  - Select and switch between AI models
  - Manage provider settings`,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Check for JSON output mode - not supported for interactive commands
			// Per the plan: Interactive commands output PLAIN TEXT errors, not JSON
			if err := global.Config.MustNotBeJSON("auth"); err != nil {
				return err
			}
			return auth.RunAuthFlow(cmd.Context(), args)
		},
	}
}
