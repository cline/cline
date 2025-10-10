package config

import (
	"fmt"
)

// camelToKebab converts camelCase to kebab-case
// e.g., "autoApprovalSettings" -> "auto-approval-settings"
func camelToKebab(s string) string {
	if s == "" {
		return s
	}

	var result []rune
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result = append(result, '-')
		}
		result = append(result, r|32) // Convert to lowercase (works for A-Z)
	}
	return string(result)
}

// formatValue formats a value for display, handling empty strings
func formatValue(val interface{}) string {
	// Handle empty strings specifically
	if str, ok := val.(string); ok && str == "" {
		return "''"
	}
	return fmt.Sprintf("%v", val)
}

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
		"useAutoCondense", "yoloModeToggled", "shellIntegrationTimeout",
		"terminalOutputLineLimit", "autoCondenseThreshold":
		fmt.Printf("%s: %s\n", camelToKebab(key), formatValue(value))
		return nil

	default:
		return fmt.Errorf("unknown config field: %s", key)
	}
}

// renderApiConfiguration renders the API configuration object
func renderApiConfiguration(value interface{}) error {
	fmt.Println("api-configuration:")

	configMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid api-configuration format")
	}

	// Print each field directly
	for key, val := range configMap {
		fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val))
	}

	return nil
}

// renderBrowserSettings renders browser settings
func renderBrowserSettings(value interface{}) error {
	fmt.Println("browser-settings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid browser-settings format")
	}

	// Handle nested viewport if present
	if viewport, ok := settingsMap["viewport"].(map[string]interface{}); ok {
		fmt.Println("  viewport:")
		for key, val := range viewport {
			fmt.Printf("    %s: %s\n", camelToKebab(key), formatValue(val))
		}
	}

	// Print other fields
	for key, val := range settingsMap {
		if key != "viewport" {
			fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val))
		}
	}

	return nil
}

// renderFocusChainSettings renders focus chain settings
func renderFocusChainSettings(value interface{}) error {
	fmt.Println("focus-chain-settings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid focus-chain-settings format")
	}

	for key, val := range settingsMap {
		fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val))
	}

	return nil
}

// renderDictationSettings renders dictation settings
func renderDictationSettings(value interface{}) error {
	fmt.Println("dictation-settings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid dictation-settings format")
	}

	for key, val := range settingsMap {
		fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val))
	}

	return nil
}

// renderAutoApprovalSettings renders auto approval settings
func renderAutoApprovalSettings(value interface{}) error {
	fmt.Println("auto-approval-settings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid auto-approval-settings format")
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
					fmt.Printf("    %s: %s\n", camelToKebab(actionKey), formatValue(actionVal))
				}
			}
		} else {
			// Print other fields normally (enabled, maxRequests, enableNotifications, favorites)
			fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val))
		}
	}

	return nil
}
