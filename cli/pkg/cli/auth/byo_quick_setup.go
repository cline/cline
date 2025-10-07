package auth

import "fmt"

// QuickAPISetup performs quick provider setup with provider ID and optional API key
func QuickAPISetup(providerID, apiKey string) error {
	fmt.Println("Quick BYO API setup is currently stubbed - not yet implemented.")
	fmt.Printf("Requested provider: %s\n", providerID)
	if apiKey != "" {
		fmt.Println("Provided API key:", "<jk redacted>")
	}
	return nil
}
