import { existsSync, readFileSync } from "node:fs";

interface GmailHeader {
	name?: string | null;
	value?: string | null;
}

interface GmailMessagePart {
	mimeType?: string | null;
	body?: { data?: string | null } | null;
	parts?: GmailMessagePart[] | null;
	headers?: GmailHeader[] | null;
}

interface GmailMessage {
	id?: string | null;
	threadId?: string | null;
	internalDate?: string | null;
	snippet?: string | null;
	payload?: GmailMessagePart | null;
}

export interface GmailClient {
	users: {
		labels: {
			list(input: { userId: "me" }): Promise<{
				data: { labels?: Array<{ id?: string | null; name?: string | null }> };
			}>;
		};
		messages: {
			list(input: {
				userId: "me";
				q?: string;
				labelIds?: string[];
				maxResults: number;
			}): Promise<{ data: { messages?: Array<{ id?: string | null }> } }>;
			get(input: {
				userId: "me";
				id: string;
				format: "full";
			}): Promise<{ data: GmailMessage }>;
		};
	};
}

export interface GmailFetchedMessage {
	id: string;
	threadId?: string;
	internalDate: string;
	snippet?: string;
	subject?: string;
	from?: string;
	to?: string;
	date?: string;
	bodyText?: string;
	bodyHtml?: string;
}

function readJsonFile(path: string): unknown {
	if (!existsSync(path)) {
		throw new Error(`File does not exist: ${path}`);
	}
	return JSON.parse(readFileSync(path, "utf8"));
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asTrimmedString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeBase64Url(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return Buffer.from(
		value.replace(/-/g, "+").replace(/_/g, "/"),
		"base64",
	).toString("utf8");
}

function headerValue(message: GmailMessage, name: string): string | undefined {
	const header = message.payload?.headers?.find(
		(entry) => entry.name?.toLowerCase() === name.toLowerCase(),
	);
	return header?.value ?? undefined;
}

function collectBodyParts(
	part: GmailMessagePart | null | undefined,
	output: { text?: string; html?: string } = {},
): { text?: string; html?: string } {
	if (!part) return output;
	const decoded = decodeBase64Url(part.body?.data ?? undefined);
	if (decoded) {
		if (part.mimeType === "text/plain") {
			output.text = output.text ? `${output.text}\n${decoded}` : decoded;
		} else if (part.mimeType === "text/html") {
			output.html = output.html ? `${output.html}\n${decoded}` : decoded;
		}
	}
	for (const child of part.parts ?? []) {
		collectBodyParts(child, output);
	}
	return output;
}

export type GmailAuthCredentials =
	| {
			kind: "access-token";
			accessToken: string;
	  }
	| {
			kind: "refresh-token";
			clientId: string;
			clientSecret: string;
			redirectUri?: string;
			refreshToken: string;
	  };

export function resolveGmailAuthCredentials(input?: {
	env?: NodeJS.ProcessEnv;
	readJsonFile?: (path: string) => unknown;
}): GmailAuthCredentials {
	const sourceEnv = input?.env ?? process.env;
	const readJson = input?.readJsonFile ?? readJsonFile;
	const getEnv = (name: string): string | undefined => {
		const value = sourceEnv[name]?.trim();
		return value ? value : undefined;
	};

	const tokenPath = getEnv("GMAIL_TOKEN_PATH");
	const token = tokenPath ? asRecord(readJson(tokenPath)) : {};
	const accessToken =
		getEnv("GMAIL_ACCESS_TOKEN") ?? asTrimmedString(token.access_token);
	if (accessToken) {
		return { kind: "access-token", accessToken };
	}

	let clientId = getEnv("GMAIL_CLIENT_ID");
	let clientSecret = getEnv("GMAIL_CLIENT_SECRET");
	let redirectUri = getEnv("GMAIL_REDIRECT_URI");

	const credentialsPath = getEnv("GMAIL_CREDENTIALS_PATH");
	if ((!clientId || !clientSecret) && credentialsPath) {
		const credentials = asRecord(readJson(credentialsPath));
		const installed = asRecord(credentials.installed);
		const web = asRecord(credentials.web);
		const source = Object.keys(installed).length > 0 ? installed : web;
		clientId = clientId ?? asTrimmedString(source.client_id);
		clientSecret = clientSecret ?? asTrimmedString(source.client_secret);
		const redirectUris = Array.isArray(source.redirect_uris)
			? source.redirect_uris
			: [];
		redirectUri = redirectUri ?? asTrimmedString(redirectUris[0]);
	}

	const refreshToken =
		getEnv("GMAIL_REFRESH_TOKEN") ?? asTrimmedString(token.refresh_token);

	if (!clientId || !clientSecret || !refreshToken) {
		throw new Error(
			"Gmail OAuth is not configured. Set GMAIL_ACCESS_TOKEN for short-lived tests, set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN, or provide GMAIL_CREDENTIALS_PATH plus GMAIL_TOKEN_PATH.",
		);
	}

	return {
		kind: "refresh-token",
		clientId,
		clientSecret,
		redirectUri,
		refreshToken,
	};
}

export async function createGmailClient(): Promise<GmailClient> {
	// `googleapis` is a package-plugin dependency. Import it lazily so unit tests
	// for the pure dedupe/gate logic can run before the optional example package
	// dependency has been installed.
	const importPackage = new Function(
		"specifier",
		"return import(specifier)",
	) as (specifier: string) => Promise<unknown>;
	const { google } = (await importPackage("googleapis")) as {
		google: {
			auth: {
				OAuth2: new (
					...args: unknown[]
				) => { setCredentials(value: unknown): void };
			};
			gmail(input: unknown): GmailClient;
		};
	};
	const credentials = resolveGmailAuthCredentials();
	const auth =
		credentials.kind === "refresh-token"
			? new google.auth.OAuth2(
					credentials.clientId,
					credentials.clientSecret,
					credentials.redirectUri,
				)
			: new google.auth.OAuth2();
	auth.setCredentials(
		credentials.kind === "refresh-token"
			? { refresh_token: credentials.refreshToken }
			: { access_token: credentials.accessToken },
	);
	return google.gmail({ version: "v1", auth });
}

export async function searchAndFetchMessages(input: {
	gmail: GmailClient;
	query?: string;
	labelId?: string;
	maxResults: number;
}): Promise<GmailFetchedMessage[]> {
	const list = await input.gmail.users.messages.list({
		userId: "me",
		...(input.query ? { q: input.query } : {}),
		...(input.labelId ? { labelIds: [input.labelId] } : {}),
		maxResults: input.maxResults,
	});
	const refs = list.data.messages ?? [];
	const fetched: GmailFetchedMessage[] = [];
	for (const ref of refs) {
		if (!ref.id) continue;
		const response = await input.gmail.users.messages.get({
			userId: "me",
			id: ref.id,
			format: "full",
		});
		const message = response.data;
		if (!message.id || !message.internalDate) continue;
		const body = collectBodyParts(message.payload);
		fetched.push({
			id: message.id,
			threadId: message.threadId ?? undefined,
			internalDate: message.internalDate,
			snippet: message.snippet ?? undefined,
			subject: headerValue(message, "Subject"),
			from: headerValue(message, "From"),
			to: headerValue(message, "To"),
			date: headerValue(message, "Date"),
			bodyText: body.text,
			bodyHtml: body.html,
		});
	}
	return fetched;
}

export async function resolveGmailLabelId(input: {
	gmail: GmailClient;
	labelName: string;
}): Promise<string> {
	const normalizedWanted = input.labelName.trim().toLowerCase();
	if (!normalizedWanted) {
		throw new Error("Gmail label name cannot be empty");
	}
	const response = await input.gmail.users.labels.list({ userId: "me" });
	const labels = response.data.labels ?? [];
	const match = labels.find((label) => {
		const name = label.name?.trim().toLowerCase();
		const id = label.id?.trim().toLowerCase();
		return name === normalizedWanted || id === normalizedWanted;
	});
	if (!match?.id) {
		throw new Error(`Gmail label not found: ${input.labelName}`);
	}
	return match.id;
}
