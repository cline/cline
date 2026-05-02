export interface HookControl {
	cancel?: boolean;
	review?: boolean;
	context?: string;
	overrideInput?: unknown;
	systemPrompt?: string;
	appendMessages?: unknown[];
	replaceMessages?: unknown[];
}
