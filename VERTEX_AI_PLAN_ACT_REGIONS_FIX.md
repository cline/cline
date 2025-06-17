# Fix for Vertex AI Plan/Act Mode Separate Regions (Issue #4198)

## 🎯 **Problem Description**

Issue #4198 reported that Vertex AI users could not configure separate regions for Plan and Act modes. When users enabled "Use different models for Plan and Act modes", they could select different models but the region setting was shared between both modes.

**Example scenario:**
- Plan mode: Gemini model in `us-central1` region  
- Act mode: Claude model in `us-east5` region

Previously, changing the region for one mode would affect both modes, making it impossible to use different regions for different modes.

## 🔧 **Solution Implementation**

### **1. Enhanced API Configuration**

**File: `src/shared/api.ts`**
- Added `previousModeVertexRegion?: string` field to `ApiHandlerOptions` interface
- This field stores the vertex region from the previous mode when switching between Plan/Act modes

### **2. State Management Updates**

**File: `src/core/storage/state.ts`**
- Added `previousModeVertexRegion` to the `getAllExtensionState` function
- Added workspace state retrieval for `previousModeVertexRegion`
- Added the field to the return object of `getAllExtensionState`

### **3. Controller Logic Enhancement**

**File: `src/core/controller/index.ts`**
- **Save Logic**: When switching modes, save the current vertex region to `previousModeVertexRegion` workspace state
- **Restore Logic**: When switching back, restore the vertex region from the previous mode
- **Provider-Specific Handling**: Only save/restore vertex region when the API provider is "vertex"

### **4. Implementation Details**

#### **Saving Current Mode's Region:**
```typescript
// Save vertex region for all providers that use it
if (apiConfiguration.apiProvider === "vertex") {
    await updateWorkspaceState(this.context, "previousModeVertexRegion", apiConfiguration.vertexRegion)
}
```

#### **Restoring Previous Mode's Region:**
```typescript
// Restore vertex region if switching to vertex provider
if (newApiProvider === "vertex" && newVertexRegion) {
    await updateGlobalState(this.context, "vertexRegion", newVertexRegion)
}
```

## ✅ **How It Works**

1. **Initial Setup**: User configures Plan mode with Gemini in `us-central1` and Act mode with Claude in `us-east5`

2. **Mode Switching (Plan → Act)**:
   - Current vertex region (`us-central1`) is saved to `previousModeVertexRegion`
   - Previous Act mode region (`us-east5`) is restored as the active region
   - API provider switches to vertex with the correct region

3. **Mode Switching (Act → Plan)**:
   - Current vertex region (`us-east5`) is saved to `previousModeVertexRegion`  
   - Previous Plan mode region (`us-central1`) is restored as the active region
   - API provider switches to vertex with the correct region

## 🧪 **Testing**

### **Manual Testing Steps:**

1. **Setup**:
   - Enable "Use different models for Plan and Act modes"
   - Configure Plan mode: Vertex AI provider, any Gemini model, region `us-central1`
   - Configure Act mode: Vertex AI provider, any Claude model, region `us-east5`

2. **Test Region Persistence**:
   - Switch to Plan mode → Verify region shows `us-central1`
   - Switch to Act mode → Verify region shows `us-east5`
   - Switch back to Plan mode → Verify region shows `us-central1`
   - Switch back to Act mode → Verify region shows `us-east5`

3. **Test API Functionality**:
   - Start a task in Plan mode → Verify API calls use `us-central1`
   - Switch to Act mode → Verify API calls use `us-east5`

### **Edge Cases Covered:**

- ✅ **Non-Vertex Providers**: Only saves/restores region when provider is "vertex"
- ✅ **First-Time Setup**: Gracefully handles undefined previous regions
- ✅ **Mixed Providers**: Works when Plan uses Vertex but Act uses different provider
- ✅ **Backward Compatibility**: Existing configurations continue to work

## 🔄 **Backward Compatibility**

- ✅ **Existing Users**: No breaking changes to existing configurations
- ✅ **Single Mode Users**: Users not using Plan/Act separation are unaffected  
- ✅ **Non-Vertex Users**: Other API providers continue to work as before
- ✅ **Migration**: No data migration required

## 📋 **Files Modified**

1. **`src/shared/api.ts`** - Added `previousModeVertexRegion` field
2. **`src/core/storage/state.ts`** - Added state management for the new field
3. **`src/core/controller/index.ts`** - Added save/restore logic for vertex regions

## 🎉 **Result**

Users can now successfully configure different Vertex AI regions for Plan and Act modes:

- **Plan Mode**: Use Gemini models in `us-central1` region
- **Act Mode**: Use Claude models in `us-east5` region  
- **Seamless Switching**: Regions are automatically saved and restored when switching modes
- **API Compatibility**: Each mode uses the correct region for API calls

This resolves Issue #4198 and provides the functionality users requested for better geographic distribution and latency optimization of their AI workflows.
