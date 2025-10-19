package config

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/client"
	"github.com/cline/grpc-go/cline"
)

type Manager struct {
	client        *client.ClineClient
	clientAddress string
}

func NewManager(ctx context.Context, address string) (*Manager, error) {
	var c *client.ClineClient
	var err error

	if address != "" {
		c, err = global.GetClientForAddress(ctx, address)
	} else {
		c, err = global.GetDefaultClient(ctx)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to get client: %w", err)
	}

	// Get the actual address being used
	clientAddress := address
	if address == "" && global.Clients != nil {
		clientAddress = global.Clients.GetRegistry().GetDefaultInstance()
	}

	return &Manager{
		client:        c,
		clientAddress: clientAddress,
	}, nil
}

// GetCurrentInstance returns the address of the current instance
func (m *Manager) GetCurrentInstance() string {
	return m.clientAddress
}

func (m *Manager) UpdateSettings(ctx context.Context, settings *cline.Settings, secrets *cline.Secrets) error {
	request := &cline.UpdateSettingsRequestCli{
		Metadata: &cline.Metadata{},
		Settings: settings,
		Secrets:  secrets,
	}

	// Call the updateSettingsCli RPC
	_, err := m.client.State.UpdateSettingsCli(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to update settings: %w", err)
	}

	fmt.Println("Settings updated successfully")
	fmt.Printf("Instance: %s\n", m.clientAddress)
	return nil
}

// UpdateSettingsPartial performs a read-merge-write operation to update settings
// This ensures that only the specified fields are updated while preserving all other settings
func (m *Manager) UpdateSettingsPartial(ctx context.Context, partialSettings *cline.Settings, partialSecrets *cline.Secrets) error {
	// Get current state
	stateData, err := m.GetState(ctx)
	if err != nil {
		return fmt.Errorf("failed to get current state: %w", err)
	}

	// Extract current settings and secrets from state
	currentSettings, currentSecrets := extractSettingsAndSecrets(stateData)

	// Merge partial updates with current values
	mergedSettings := mergeSettings(currentSettings, partialSettings)
	mergedSecrets := mergeSecrets(currentSecrets, partialSecrets)

	// Update with the merged values
	return m.UpdateSettings(ctx, mergedSettings, mergedSecrets)
}

func (m *Manager) GetState(ctx context.Context) (map[string]interface{}, error) {
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return nil, fmt.Errorf("failed to get state: %w", err)
	}

	var stateData map[string]interface{}
	if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
		return nil, fmt.Errorf("failed to parse state: %w", err)
	}

	return stateData, nil
}

func (m *Manager) ListSettings(ctx context.Context) error {
	// Get state
	stateData, err := m.GetState(ctx)
	if err != nil {
		return err
	}

	// Subset of fields we will print the values for
	settingsFields := []string{
		"apiConfiguration",
		"telemetrySetting",
		"planActSeparateModelsSetting",
		"enableCheckpointsSetting",
		"mcpMarketplaceEnabled",
		"shellIntegrationTimeout",
		"terminalReuseEnabled",
		"mcpResponsesCollapsed",
		"mcpDisplayMode",
		"terminalOutputLineLimit",
		"mode",
		"preferredLanguage",
		"openaiReasoningEffort",
		"strictPlanModeEnabled",
		"focusChainSettings",
		"useAutoCondense",
		"customPrompt",
		"browserSettings",
		"defaultTerminalProfile",
		"yoloModeToggled",
		"dictationSettings",
		"autoCondenseThreshold",
		"autoApprovalSettings",
	}

	// Render each field using the renderer
	for _, field := range settingsFields {
		if value, ok := stateData[field]; ok {
			if err := RenderField(field, value, true); err != nil {
				fmt.Printf("Error rendering %s: %v\n", field, err)
			}
			fmt.Println()
		}
	}

	return nil
}

func (m *Manager) GetSetting(ctx context.Context, key string) error {
	// Get state
	stateData, err := m.GetState(ctx)
	if err != nil {
		return err
	}

	// Convert kebab-case to camelCase path
	parts := kebabToCamelPath(key)
	rootField := parts[0]

	// Get the value
	value, found := getNestedValue(stateData, parts)
	if !found {
		return fmt.Errorf("setting '%s' not found", key)
	}

	// Render the value
	if len(parts) == 1 {
		// Top-level field: use RenderField for nice formatting
		return RenderField(rootField, value, false)
	} else {
		// Nested field: simple print
		fmt.Printf("%s: %s\n", key, formatValue(value, rootField, true))
	}

	return nil
}

// kebabToCamelPath converts a kebab-case path to camelCase
// e.g., "auto-approval-settings.actions.read-files" -> "autoApprovalSettings.actions.readFiles"
func kebabToCamelPath(path string) []string {
	parts := strings.Split(path, ".")
	for i, part := range parts {
		parts[i] = kebabToCamel(part)
	}
	return parts
}

// kebabToCamel converts a single kebab-case string to camelCase
// e.g., "auto-approval-settings" -> "autoApprovalSettings"
func kebabToCamel(s string) string {
	if s == "" {
		return s
	}

	parts := strings.Split(s, "-")
	if len(parts) == 1 {
		return s
	}

	// First part stays lowercase, rest are capitalized
	result := parts[0]
	for i := 1; i < len(parts); i++ {
		if parts[i] != "" {
			result += strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return result
}

// getNestedValue retrieves a value from a nested map using dot notation
// e.g., "autoApprovalSettings.actions.readFiles"
func getNestedValue(data map[string]interface{}, parts []string) (interface{}, bool) {
	current := interface{}(data)

	for _, part := range parts {
		// Try to access as map
		if m, ok := current.(map[string]interface{}); ok {
			if val, exists := m[part]; exists {
				current = val
				continue
			}
			return nil, false
		}
		return nil, false
	}

	return current, true
}