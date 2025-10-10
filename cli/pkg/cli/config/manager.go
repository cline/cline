package config

import (
	"context"
	"encoding/json"
	"fmt"

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
			if err := RenderField(field, value); err != nil {
				fmt.Printf("Error rendering %s: %v\n", field, err)
			}
			fmt.Println()
		}
	}

	return nil
}
