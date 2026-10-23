/**
 * Offline verification for the short-lived Ed25519 capability JWT issued by
 * Cloud API. The relay needs only the public key: it never receives a Cline
 * account session token and does not call Cloud API on the websocket hot
 * path.
 */

import { createPublicKey, verify } from "node:crypto";
import type { RelayAccount, VerifyAccount } from "./server";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE64URL = /^[A-Za-z0-9_-]+$/;

interface RelayTicketHeader {
	alg?: unknown;
	typ?: unknown;
}

interface RelayTicketClaims {
	iss?: unknown;
	sub?: unknown;
	aud?: unknown;
	exp?: unknown;
	nbf?: unknown;
	iat?: unknown;
	jti?: unknown;
	machineId?: unknown;
	role?: unknown;
}

export interface CreateRelayTicketVerifyAccountOptions {
	/** Canonical unpadded base64url Ed25519 public key (32 raw bytes). */
	publicKey: string;
	issuer: string;
	audience: string;
	/** Allowed clock disagreement between core and relay. Default: 10 seconds. */
	clockSkewSeconds?: number;
	/** Defense against accidentally issuing durable bearer capabilities. */
	maxTicketLifetimeSeconds?: number;
	/** In-memory one-use replay cache bound for this single relay process. */
	maxSeenJtis?: number;
	now?: () => number;
}

function decodeCanonical(value: string): Buffer | undefined {
	if (!value || !BASE64URL.test(value) || value.length % 4 === 1) {
		return undefined;
	}
	const decoded = Buffer.from(value, "base64url");
	return decoded.toString("base64url") === value ? decoded : undefined;
}

function decodeJSON<T>(value: string): T | undefined {
	const decoded = decodeCanonical(value);
	if (!decoded) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(decoded.toString("utf8"));
		return parsed && typeof parsed === "object" ? (parsed as T) : undefined;
	} catch {
		return undefined;
	}
}

function audienceIncludes(value: unknown, expected: string): boolean {
	return (
		value === expected ||
		(Array.isArray(value) &&
			value.every((entry) => typeof entry === "string") &&
			value.includes(expected))
	);
}

export function createRelayTicketVerifyAccount(
	options: CreateRelayTicketVerifyAccountOptions,
): VerifyAccount {
	const rawPublicKey = decodeCanonical(options.publicKey);
	if (!rawPublicKey || rawPublicKey.length !== 32) {
		throw new Error(
			"relay ticket public key must be canonical base64url for 32 bytes",
		);
	}
	if (!options.issuer || !options.audience) {
		throw new Error("relay ticket issuer and audience are required");
	}
	const publicKey = createPublicKey({
		key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
		format: "der",
		type: "spki",
	});
	const clockSkew = options.clockSkewSeconds ?? 10;
	const maxLifetime = options.maxTicketLifetimeSeconds ?? 300;
	const maxSeenJtis = options.maxSeenJtis ?? 100_000;
	if (clockSkew < 0 || maxLifetime <= 0 || maxSeenJtis <= 0) {
		throw new Error("relay ticket verifier limits must be positive");
	}
	const now = options.now ?? (() => Date.now() / 1000);
	const seenJtis = new Map<string, number>();

	return ({ role, token }): RelayAccount | undefined => {
		const parts = token?.split(".");
		if (!parts || parts.length !== 3) {
			return undefined;
		}
		const [encodedHeader, encodedClaims, encodedSignature] = parts as [
			string,
			string,
			string,
		];
		const header = decodeJSON<RelayTicketHeader>(encodedHeader);
		const claims = decodeJSON<RelayTicketClaims>(encodedClaims);
		const signature = decodeCanonical(encodedSignature);
		if (
			!header ||
			header.alg !== "EdDSA" ||
			header.typ !== "relay-ticket+jwt" ||
			!claims ||
			!signature ||
			!verify(
				null,
				Buffer.from(`${encodedHeader}.${encodedClaims}`),
				publicKey,
				signature,
			)
		) {
			return undefined;
		}

		const current = Math.floor(now());
		if (
			claims.iss !== options.issuer ||
			typeof claims.sub !== "string" ||
			!claims.sub ||
			!audienceIncludes(claims.aud, options.audience) ||
			typeof claims.machineId !== "string" ||
			!claims.machineId ||
			claims.role !== role ||
			typeof claims.iat !== "number" ||
			typeof claims.nbf !== "number" ||
			typeof claims.exp !== "number" ||
			typeof claims.jti !== "string" ||
			!claims.jti ||
			claims.iat > current + clockSkew ||
			claims.nbf > current + clockSkew ||
			!Number.isSafeInteger(claims.iat) ||
			!Number.isSafeInteger(claims.nbf) ||
			!Number.isSafeInteger(claims.exp) ||
			claims.nbf < claims.iat ||
			claims.exp <= current - clockSkew ||
			claims.exp <= claims.iat ||
			claims.exp - claims.iat > maxLifetime
		) {
			return undefined;
		}

		for (const [jti, expiresAt] of seenJtis) {
			if (expiresAt <= current - clockSkew) {
				seenJtis.delete(jti);
			}
		}
		if (seenJtis.has(claims.jti) || seenJtis.size >= maxSeenJtis) {
			return undefined;
		}
		seenJtis.set(claims.jti, claims.exp);
		return {
			accountId: claims.sub,
			machineId: claims.machineId,
		};
	};
}
