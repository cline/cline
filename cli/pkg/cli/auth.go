package cli

import (
	"github.com/cline/cli/pkg/cli/auth"
	"github.com/spf13/cobra"
)

func NewAuthCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Authenticate a provider and configure what model is used",
		Long: `Authenticate a provider and configure what model is used

Interactive Mode:
  Run without flags to open an interactive menu where you can:
  - Sign in to your Cline account
  - Configure other LLM providers (Anthropic, OpenAI, etc.)
  - Select and switch between AI models
  - Manage provider settings

Quick Setup Mode:
  Use flags to quickly configure a BYO provider non-interactively:
  
  Examples:
    cline auth --provider openai-native --apikey sk-xxx --modelid gpt-5
    cline auth -p anthropic -k sk-ant-xxx -m claude-sonnet-4-5-20250929
    cline auth -p openai-compatible -k xxx -m gpt-4 -b https://api.example.com/v1
    
  Supported providers: openai-native, openai, anthropic, gemini, openrouter, xai, cerebras, ollama
  Note: Bedrock provider requires interactive setup due to complex auth fields`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return auth.RunAuthFlow(cmd.Context(), args)
		},
	}

	// Add flags for quick setup mode
	cmd.Flags().StringVarP(&auth.QuickProvider, "provider", "p", "", "Provider ID for quick setup (e.g., openai-native, anthropic)")
	cmd.Flags().StringVarP(&auth.QuickAPIKey, "apikey", "k", "", "API key for the provider")
	cmd.Flags().StringVarP(&auth.QuickModelID, "modelid", "m", "", "Model ID to configure (e.g., gpt-4o, claude-sonnet-4-5-20250929)")
	cmd.Flags().StringVarP(&auth.QuickBaseURL, "baseurl", "b", "", "Base URL (optional, only for openai provider)")

	return cmd
}
