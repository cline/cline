package config

import (
	"fmt"
)

// RenderField renders a single config field with proper formatting
func RenderField(key string, value interface{}) error {
	switch key {
	// Nested objects - render with header + nested fields
	case "apiConfiguration":
		return renderApiConfiguration(value)
	case "browserSettings":
		return renderBrowserSettings(value)
	case "focusChainSettings":
		return renderFocusChainSettings(value)
	case "dictationSettings":
		return renderDictationSettings(value)
	case "autoApprovalSettings":
		return renderAutoApprovalSettings(value)

	// Simple values - just print key: value
	case "mode", "telemetrySetting", "preferredLanguage", "customPrompt",
		"defaultTerminalProfile", "mcpDisplayMode", "openaiReasoningEffort",
		"planActSeparateModelsSetting", "enableCheckpointsSetting",
		"mcpMarketplaceEnabled", "terminalReuseEnabled",
		"mcpResponsesCollapsed", "strictPlanModeEnabled",
		"useAutoCondense", "yoloModeToggled","shellIntegrationTimeout",
		"terminalOutputLineLimit","autoCondenseThreshold":
		fmt.Printf("%s: %v\n", key, value)
		return nil

	default:
		return fmt.Errorf("unknown config field: %s", key)
	}
}

// renderApiConfiguration renders the API configuration object
func renderApiConfiguration(value interface{}) error {
	fmt.Println("apiConfiguration:")

	configMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid apiConfiguration format")
	}

	// Print each field directly
	for key, val := range configMap {
		fmt.Printf("  %s: %v\n", key, val)
	}

	return nil
}

// renderBrowserSettings renders browser settings
func renderBrowserSettings(value interface{}) error {
	fmt.Println("browserSettings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid browserSettings format")
	}

	// Handle nested viewport if present
	if viewport, ok := settingsMap["viewport"].(map[string]interface{}); ok {
		fmt.Println("  viewport:")
		for key, val := range viewport {
			fmt.Printf("    %s: %v\n", key, val)
		}
	}

	// Print other fields
	for key, val := range settingsMap {
		if key != "viewport" {
			fmt.Printf("  %s: %v\n", key, val)
		}
	}

	return nil
}

// renderFocusChainSettings renders focus chain settings
func renderFocusChainSettings(value interface{}) error {
	fmt.Println("focusChainSettings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid focusChainSettings format")
	}

	for key, val := range settingsMap {
		fmt.Printf("  %s: %v\n", key, val)
	}

	return nil
}

// renderDictationSettings renders dictation settings
func renderDictationSettings(value interface{}) error {
	fmt.Println("dictationSettings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid dictationSettings format")
	}

	for key, val := range settingsMap {
		fmt.Printf("  %s: %v\n", key, val)
	}

	return nil
}

// renderAutoApprovalSettings renders auto approval settings
func renderAutoApprovalSettings(value interface{}) error {
	fmt.Println("autoApprovalSettings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid autoApprovalSettings format")
	}

	// Print top-level fields (skip version, handle actions specially)
	for key, val := range settingsMap {
		if key == "version" {
			continue // Skip version
		}

		if key == "actions" {
			// Handle nested actions with double indentation
			fmt.Println("  actions:")
			if actionsMap, ok := val.(map[string]interface{}); ok {
				for actionKey, actionVal := range actionsMap {
					fmt.Printf("    %s: %v\n", actionKey, actionVal)
				}
			}
		} else {
			// Print other fields normally (enabled, maxRequests, enableNotifications, favorites)
			fmt.Printf("  %s: %v\n", key, val)
		}
	}

	return nil
}
