import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"

export type MentionHandler = (mention: string) => Promise<string>

export type XmlTag = {
	start: string
	end: string
}

export interface MentionContext {
	cwd: string
	urlContentFetcher: UrlContentFetcher
	launchBrowserError?: Error
	osInfo: string
}

export interface HandlerConfig {
	name: string
	test: (mention: string, context: MentionContext) => boolean
	handler: (mention: string, context: MentionContext) => Promise<string>
}
