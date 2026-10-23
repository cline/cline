import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	HUB_CAPABILITIES,
	HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
	isHubProtocolCompatible,
	LEGACY_HUB_PROTOCOL_VERSION,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeHost } from "../../../runtime/host/runtime-host";
import {
	HUB_TRANSPORT_CAPABILITIES,
	handleClientRegister,
} from "./client-handlers";
import {
	buildHubEvent,
	defaultAuthorizeAttach,
	type HubTransportContext,
} from "./context";

function createContext(): HubTransportContext & { events: HubEventEnvelope[] } {
	const events: HubEventEnvelope[] = [];
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionTrustModel: "session-scoped",
		attachAllowlist: new Set<string>(),
		authorizeAttach: defaultAuthorizeAttach,
		activeRpcTurnCountBySession: new Map(),
		sessionSearch: { removeSession: vi.fn() } as never,
		sessionHost: {
			subscribe: vi.fn(),
			startSession: vi.fn(),
			runTurn: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			listSessions: vi.fn(),
		} as unknown as RuntimeHost,
		publish: (event) => {
			events.push(event);
		},
		buildEvent: buildHubEvent,
		requestCapability: vi.fn(),
		events,
	};
}

function registerEnvelope(
	payload?: Record<string, unknown>,
	clientId?: string,
): HubCommandEnvelope {
	return {
		version: "v1",
		command: "client.register",
		requestId: "req_1",
		...(clientId ? { clientId } : {}),
		...(payload ? { payload } : {}),
	};
}

describe("handleClientRegister protocol handshake", () => {
	it("rejects a client protocol outside the supported range", () => {
		const ctx = createContext();
		const reply = handleClientRegister(
			ctx,
			registerEnvelope({
				clientId: "client-future",
				clientType: "mobile",
				transport: "browser-ws",
				protocolVersion: "v2",
			}),
		);

		expect(reply.ok).toBe(false);
		expect(reply.error).toEqual({
			code: HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
			message: `Hub protocol ${CURRENT_HUB_PROTOCOL_VERSION} does not support client protocol v2 (supported client protocol range: ${MIN_CLIENT_HUB_PROTOCOL_VERSION}..${MAX_CLIENT_HUB_PROTOCOL_VERSION}).`,
			details: {
				serverProtocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
				minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
				maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
				clientProtocolVersion: "v2",
			},
		});
		expect(ctx.clients.size).toBe(0);
		expect(ctx.events).toEqual([]);
	});

	it("rejects an unparsable protocol version", () => {
		const ctx = createContext();
		const reply = handleClientRegister(
			ctx,
			registerEnvelope({
				clientType: "mobile",
				transport: "browser-ws",
				protocolVersion: "banana",
			}),
		);

		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe(HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE);
		expect(reply.error?.details).toMatchObject({
			clientProtocolVersion: "banana",
		});
		expect(ctx.clients.size).toBe(0);
	});

	it("returns protocol metadata and capabilities to a compatible client", () => {
		const ctx = createContext();
		const reply = handleClientRegister(
			ctx,
			registerEnvelope({
				clientId: "client-ok",
				clientType: "mobile",
				transport: "browser-ws",
				protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
			}),
		);

		expect(reply.ok).toBe(true);
		expect(reply.payload).toEqual({
			clientId: "client-ok",
			protocol: {
				protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
				minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
				maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
			},
			capabilities: [...HUB_TRANSPORT_CAPABILITIES],
		});
		expect(ctx.clients.get("client-ok")?.clientType).toBe("mobile");
	});

	it("advertises exactly the shared capability list", () => {
		// One source of truth: the register reply and `/version` both read
		// HUB_CAPABILITIES, so `hasCapability` cannot disagree with itself.
		expect([...HUB_TRANSPORT_CAPABILITIES]).toEqual([...HUB_CAPABILITIES]);
		expect(HUB_TRANSPORT_CAPABILITIES).toContain("approval.list_pending");
		expect(HUB_TRANSPORT_CAPABILITIES).toContain("session.create");
	});

	it("range-checks a legacy client instead of skipping the check", () => {
		// A hub that no longer supports the legacy version must refuse it rather
		// than fall through the absent-protocolVersion hole.
		expect(
			isHubProtocolCompatible(
				{
					protocolVersion: "v2",
					minClientProtocolVersion: "v2",
					maxClientProtocolVersion: "v2",
				},
				LEGACY_HUB_PROTOCOL_VERSION,
			).compatible,
		).toBe(false);
	});

	it("accepts a legacy client that sends no protocol version", () => {
		const ctx = createContext();
		for (const protocolVersion of [undefined, "", "   "]) {
			const reply = handleClientRegister(
				ctx,
				registerEnvelope({
					clientId: "client-legacy",
					clientType: "cli",
					transport: "native",
					...(protocolVersion === undefined ? {} : { protocolVersion }),
				}),
			);
			expect(reply.ok).toBe(true);
			expect(reply.payload).toMatchObject({ clientId: "client-legacy" });
		}
		expect(ctx.clients.has("client-legacy")).toBe(true);
	});
});

describe("handleClientRegister registration", () => {
	it("falls back to the envelope client id and records the client", () => {
		const ctx = createContext();
		const reply = handleClientRegister(
			ctx,
			registerEnvelope(
				{ clientType: "cli", transport: "native" },
				"env-client",
			),
		);

		expect(reply.payload).toMatchObject({ clientId: "env-client" });
		expect(ctx.clients.get("env-client")).toMatchObject({
			clientId: "env-client",
			clientType: "cli",
			actorKind: "client",
			transport: "native",
			capabilities: [],
		});
		expect(ctx.events.map((event) => event.event)).toEqual([
			"hub.client.registered",
		]);
		expect(ctx.events[0]?.payload).toMatchObject({
			clientId: "env-client",
			clientType: "cli",
		});
	});

	it("generates a client id and defaults when the payload is empty", () => {
		const ctx = createContext();
		const reply = handleClientRegister(ctx, registerEnvelope());

		const clientId = (reply.payload as { clientId: string }).clientId;
		expect(clientId).toMatch(/^client_/);
		expect(ctx.clients.get(clientId)).toMatchObject({
			clientType: "unknown",
			actorKind: "client",
			transport: "native",
		});
	});
});
