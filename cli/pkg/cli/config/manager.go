package config

import (
	"context"
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
