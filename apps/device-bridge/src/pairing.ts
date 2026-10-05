import {
	createHash,
	randomBytes,
	randomInt,
	timingSafeEqual,
} from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface PairedDevice {
	name: string;
	/** sha256 of the device token; the token itself is never stored. */
	tokenHash: string;
	pairedAt: string;
	lastSeenAt?: string;
}

const PAIRING_CODE_TTL_MS = 5 * 60_000;
const MAX_PAIR_ATTEMPTS = 5;

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * One-time pairing codes and long-lived device tokens.
 * Tokens are persisted hashed in a 0600 JSON file.
 */
export class DeviceRegistry {
	private devices: PairedDevice[] = [];
	private code?: { value: string; expiresAt: number; attempts: number };

	constructor(
		private readonly filePath: string,
		private readonly now: () => number = Date.now,
	) {
		if (existsSync(filePath)) {
			try {
				const parsed = JSON.parse(readFileSync(filePath, "utf8"));
				if (Array.isArray(parsed?.devices)) this.devices = parsed.devices;
			} catch {
				this.devices = [];
			}
		}
	}

	list(): readonly PairedDevice[] {
		return this.devices;
	}

	/** Issue a fresh 6-digit code, replacing any previous one. */
	issueCode(): { code: string; expiresAt: number } {
		const value = String(randomInt(0, 1_000_000)).padStart(6, "0");
		this.code = {
			value,
			expiresAt: this.now() + PAIRING_CODE_TTL_MS,
			attempts: 0,
		};
		return { code: value, expiresAt: this.code.expiresAt };
	}

	/** Returns a new device token on success. Codes are single-use. */
	pair(code: string, name: string): string | undefined {
		const current = this.code;
		if (!current || current.expiresAt < this.now()) return undefined;
		current.attempts++;
		if (current.attempts > MAX_PAIR_ATTEMPTS) {
			this.code = undefined;
			return undefined;
		}
		const a = Buffer.from(code.padEnd(6).slice(0, 6));
		const b = Buffer.from(current.value);
		if (!timingSafeEqual(a, b)) return undefined;
		this.code = undefined;
		const token = randomBytes(24).toString("base64url");
		this.devices.push({
			name: name.slice(0, 32) || "cline-pet",
			tokenHash: hashToken(token),
			pairedAt: new Date(this.now()).toISOString(),
		});
		this.save();
		return token;
	}

	authenticate(token: string): PairedDevice | undefined {
		const hash = Buffer.from(hashToken(token));
		const device = this.devices.find((d) =>
			timingSafeEqual(Buffer.from(d.tokenHash), hash),
		);
		if (device) {
			device.lastSeenAt = new Date(this.now()).toISOString();
			this.save();
		}
		return device;
	}

	revoke(name: string): boolean {
		const before = this.devices.length;
		this.devices = this.devices.filter((d) => d.name !== name);
		if (this.devices.length !== before) this.save();
		return this.devices.length !== before;
	}

	private save(): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(
			this.filePath,
			`${JSON.stringify({ devices: this.devices }, null, 2)}\n`,
			{
				mode: 0o600,
			},
		);
		try {
			chmodSync(this.filePath, 0o600);
		} catch {
			// Windows has no POSIX modes.
		}
	}
}
