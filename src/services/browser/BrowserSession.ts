// Browser automation has been removed. Stub class for compilation compatibility.

export interface BrowserConnectionInfo {
	isConnected: boolean
	isRemote: boolean
	host?: string
}

export class BrowserSession {
	// biome-ignore lint/complexity/noUselessConstructor: stub needs to accept args
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	constructor(..._args: any[]) {}
	setUlid(_ulid: string): void {}
	async launchBrowser(_url: string): Promise<void> {
		throw new Error("Browser automation has been removed")
	}
	async closeBrowser(): Promise<void> {}
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	async navigateToUrl(_url: string): Promise<any> {
		throw new Error("Browser automation has been removed")
	}
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	async click(_coordinate: string): Promise<any> {
		throw new Error("Browser automation has been removed")
	}
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	async type(_text: string): Promise<any> {
		throw new Error("Browser automation has been removed")
	}
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	async scrollDown(): Promise<any> {
		throw new Error("Browser automation has been removed")
	}
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	async scrollUp(): Promise<any> {
		throw new Error("Browser automation has been removed")
	}
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	async screenshot(): Promise<any> {
		throw new Error("Browser automation has been removed")
	}
	dispose(): void {}
}
