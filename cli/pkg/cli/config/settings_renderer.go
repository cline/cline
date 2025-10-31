package config

import (
	"fmt"
	"strings"
)

// sensitiveKeywords defines field name patterns that should be censored
var sensitiveKeywords = []string{"key", "secret", "password", "cline-account-id"}

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

// isSensitiveField checks if a field name contains sensitive keywords
func isSensitiveField(fieldName string) bool {
	if fieldName == "" {
		return false
	}
	
	lowerName := strings.ToLower(fieldName)
	for _, keyword := range sensitiveKeywords {
		if strings.Contains(lowerName, keyword) {
			return true
		}
	}
	
	return false
}

// formatValue formats a value for display, handling empty strings and censoring sensitive fields
func formatValue(val interface{}, fieldName string, censor bool) string {
	// Handle empty strings specifically
	if str, ok := val.(string); ok && str == "" {
		return "''"
	}
	
	if censor && isSensitiveField(fieldName) {
		valStr := fmt.Sprintf("%v", val)
		if valStr != "" && valStr != "''" {
			return "********"
		}
	}
	
	return fmt.Sprintf("%v", val)
}

// RenderField renders a single config field with proper formatting
func RenderField(key string, value interface{}, censor bool) error {
	switch key {
	// Nested objects - render with header + nested fields
	case "apiConfiguration":
		return renderApiConfiguration(value, censor)
	case "browserSettings":
		return renderBrowserSettings(value, censor)
	case "focusChainSettings":
		return renderFocusChainSettings(value, censor)
	case "dictationSettings":
		return renderDictationSettings(value, censor)
	case "autoApprovalSettings":
		return renderAutoApprovalSettings(value, censor)

	// Simple values - just print key: value
	case "mode", "telemetrySetting", "preferredLanguage", "customPrompt",
		"defaultTerminalProfile", "mcpDisplayMode", "openaiReasoningEffort",
		"planActSeparateModelsSetting", "enableCheckpointsSetting",
		"mcpMarketplaceEnabled", "terminalReuseEnabled",
		"mcpResponsesCollapsed", "strictPlanModeEnabled",
		"useAutoCondense", "yoloModeToggled", "shellIntegrationTimeout",
		"terminalOutputLineLimit", "autoCondenseThreshold":
		fmt.Printf("%s: %s\n", camelToKebab(key), formatValue(value, key, censor))
		return nil

	default:
		return fmt.Errorf("unknown config field: %s", key)
	}
}

// renderApiConfiguration renders the API configuration object
func renderApiConfiguration(value interface{}, censor bool) error {
	fmt.Println("api-configuration:")

	configMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid api-configuration format")
	}

	// Print each field directly
	for key, val := range configMap {
		fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val, key, censor))
	}

	return nil
}

// renderBrowserSettings renders browser settings
func renderBrowserSettings(value interface{}, censor bool) error {
	fmt.Println("browser-settings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid browser-settings format")
	}

	// Handle nested viewport if present
	if viewport, ok := settingsMap["viewport"].(map[string]interface{}); ok {
		fmt.Println("  viewport:")
		for key, val := range viewport {
			fmt.Printf("    %s: %s\n", camelToKebab(key), formatValue(val, key, censor))
		}
	}

	// Print other fields
	for key, val := range settingsMap {
		if key != "viewport" {
			fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val, key, censor))
		}
	}

	return nil
}

// renderFocusChainSettings renders focus chain settings
func renderFocusChainSettings(value interface{}, censor bool) error {
	fmt.Println("focus-chain-settings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid focus-chain-settings format")
	}

	for key, val := range settingsMap {
		fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val, key, censor))
	}

	return nil
}

// renderDictationSettings renders dictation settings
func renderDictationSettings(value interface{}, censor bool) error {
	fmt.Println("dictation-settings:")

	settingsMap, ok := value.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid dictation-settings format")
	}

	for key, val := range settingsMap {
		fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val, key, censor))
	}

	return nil
}

// renderAutoApprovalSettings renders auto approval settings
func renderAutoApprovalSettings(value interface{}, censor bool) error {
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
					fmt.Printf("    %s: %s\n", camelToKebab(actionKey), formatValue(actionVal, actionKey, censor))
				}
			}
		} else {
			// Print other fields normally (enabled, enableNotifications, favorites)
			fmt.Printf("  %s: %s\n", camelToKebab(key), formatValue(val, key, censor))
		}
	}

	return nil
}
