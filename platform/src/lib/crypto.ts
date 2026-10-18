import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AAD = Buffer.from("21-agent:openrouter-key:v1", "utf8");

export type EncryptedSecret = {
	ciphertext: string;
	iv: string;
	authTag: string;
};

function encryptionKey(): Buffer {
	const raw = process.env.ENCRYPTION_KEY;
	if (!raw) {
		throw new Error("ENCRYPTION_KEY is not configured");
	}
	let key: Buffer;
	try {
		key = Buffer.from(raw, "base64");
	} catch {
		throw new Error("ENCRYPTION_KEY must be base64 encoded");
	}
	if (key.length !== 32) {
		throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
	}
	return key;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
	cipher.setAAD(AAD);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return {
		ciphertext: ciphertext.toString("base64"),
		iv: iv.toString("base64"),
		authTag: authTag.toString("base64"),
	};
}

export function decryptSecret(secret: EncryptedSecret): string {
	const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(secret.iv, "base64"));
	decipher.setAAD(AAD);
	decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(secret.ciphertext, "base64")),
		decipher.final(),
	]);
	return plaintext.toString("utf8");
}

export function lastFour(value: string): string {
	return value.slice(-4);
}

export function constantTimeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => a.localeCompare(b));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function hashToolInput(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function hashToken(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
