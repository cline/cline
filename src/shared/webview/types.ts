export enum WebviewProviderType {
	SIDEBAR = "sidebar",
	TAB = "tab",
}

declare global {
	interface Window {
		WEBVIEW_PROVIDER_TYPE?: WebviewProviderType
	}
}
