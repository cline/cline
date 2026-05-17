export interface PluginInitializationFailure {
	pluginPath: string;
	pluginName?: string;
	phase: "load" | "setup";
	message: string;
	stack?: string;
}

export interface PluginInitializationWarning {
	type: "duplicate_plugin_override";
	pluginPath: string;
	pluginName: string;
	overriddenPluginPath: string;
	message: string;
}

export interface PluginLoadDiagnostics {
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}
