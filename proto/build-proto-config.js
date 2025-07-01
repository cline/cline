// Configuration file for protocol buffer build scripts
// Contains service name mappings used by both build-proto.js and build-go-proto.js

// List of gRPC services
// To add a new service, simply add it to this map and run the build scripts
// The service handler will be automatically discovered and used by grpc-handler.ts
export const serviceNameMap = {
	account: "cline.AccountService",
	browser: "cline.BrowserService",
	checkpoints: "cline.CheckpointsService",
	file: "cline.FileService",
	mcp: "cline.McpService",
	state: "cline.StateService",
	task: "cline.TaskService",
	web: "cline.WebService",
	models: "cline.ModelsService",
	slash: "cline.SlashService",
	ui: "cline.UiService",
	// Add new services here - no other code changes needed!
}

// List of host gRPC services (IDE API bridge)
// These services are implemented in the IDE extension and called by the standalone Cline Core
export const hostServiceNameMap = {
	uri: "host.UriService",
	watch: "host.WatchService",
	workspace: "host.WorkspaceService",
	env: "host.EnvService",
	window: "host.WindowService",
	// Add new host services here
}
