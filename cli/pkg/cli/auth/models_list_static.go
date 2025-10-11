package auth

import (
	"fmt"
	"sort"

	"github.com/cline/cli/pkg/generated"
	"github.com/cline/grpc-go/cline"
)

// SupportsStaticModelList returns true if the provider has a predefined static model list
func SupportsStaticModelList(provider cline.ApiProvider) bool {
	providerID := GetProviderIDForEnum(provider)
	if providerID == "" {
		return false
	}

	// Check if this provider has static models defined
	def, err := generated.GetProviderDefinition(providerID)
	if err != nil {
		return false
	}

	// Return true if provider has models and isn't dynamic-only
	// (Dynamic providers like OpenRouter/OpenAI/Ollama fetch from API)
	return len(def.Models) > 0 && !def.HasDynamicModels
}

// FetchStaticModels retrieves the static model list for a provider from generated definitions
// Returns a sorted list of model IDs and a map of model IDs to their info
func FetchStaticModels(provider cline.ApiProvider) ([]string, map[string]generated.ModelInfo, error) {
	providerID := GetProviderIDForEnum(provider)
	if providerID == "" {
		return nil, nil, fmt.Errorf("unknown provider enum: %v", provider)
	}

	def, err := generated.GetProviderDefinition(providerID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get provider definition: %w", err)
	}

	if len(def.Models) == 0 {
		return nil, nil, fmt.Errorf("no models defined for provider %s", providerID)
	}

	// Extract model IDs and sort them
	modelIDs := make([]string, 0, len(def.Models))
	for modelID := range def.Models {
		modelIDs = append(modelIDs, modelID)
	}
	sort.Strings(modelIDs)

	return modelIDs, def.Models, nil
}

// GetDefaultModelForProvider returns the default model ID for a provider if one is defined
func GetDefaultModelForProvider(provider cline.ApiProvider) string {
	providerID := GetProviderIDForEnum(provider)
	if providerID == "" {
		return ""
	}

	def, err := generated.GetProviderDefinition(providerID)
	if err != nil {
		return ""
	}

	return def.DefaultModelID
}
