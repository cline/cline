package generated

// FieldOverrides allows manual control over field relevance per provider
// This file is NOT auto-generated and can be edited manually to override
// the automatic field filtering logic.
//
// Usage:
//   - Add provider-specific overrides to force include/exclude fields
//   - true = force include this field for this provider
//   - false = force exclude this field for this provider
//   - If no override exists, automatic filtering logic applies
var FieldOverrides = map[string]map[string]bool{
	// Format: "provider_id": {"field_name": shouldInclude}

	// Example overrides (uncomment and modify as needed):

	// "anthropic": {
	// 	"requestTimeoutMs": true,  // explicitly include
	// 	"ollamaBaseUrl": false,    // explicitly exclude
	// },

	// "bedrock": {
	// 	"awsSessionToken": true,   // include even if marked optional
	// 	"azureApiVersion": false,  // exclude even if general
	// },

	// Add more provider-specific overrides as needed
}

// GetFieldOverride returns the override setting for a field, if one exists
// Returns (shouldInclude, hasOverride)
func GetFieldOverride(providerID, fieldName string) (bool, bool) {
	if providerOverrides, exists := FieldOverrides[providerID]; exists {
		if override, hasOverride := providerOverrides[fieldName]; hasOverride {
			return override, true
		}
	}
	return false, false
}
