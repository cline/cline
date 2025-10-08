package cli

import (
	"github.com/cline/cli/pkg/cli/auth"
	"github.com/spf13/cobra"
)

func NewAuthCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "auth",
		Short: "Sign in to Cline",
		Long:  `Complete the authentication flow in browser to sign in to Cline.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return auth.HandleAuthCommand(cmd.Context(), args)
		},
	}
}
