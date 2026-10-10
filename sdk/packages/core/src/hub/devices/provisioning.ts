import {
	createCipheriv,
	createECDH,
	createHash,
	randomBytes,
} from "node:crypto";

import {
	DEVICE_SETUP_CODE_CONTEXT,
	DEVICE_SETUP_MAX_CONFIG_BYTES,
	DEVICE_SETUP_TTL_MS,
	type DeviceSetupState,
	type DeviceWifiSettings,
} from "@cline/device";

export type { DeviceSetupState, DeviceWifiSettings } from "@cline/device";

const PORTAL = "http://192.168.4.1";

/** Temporary keys only; credentials never enter snapshots or persistent storage. */
export class DeviceProvisioning {
	private expiryTimer?: ReturnType<typeof setTimeout>;
	private session?: { id: string; key: Buffer; state: DeviceSetupState };
	constructor(private readonly request: typeof fetch = fetch) {}
	private async post(
		path: string,
		body: unknown,
	): Promise<Record<string, unknown>> {
		let response: Response;
		try {
			response = await this.request(`${PORTAL}${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(5000),
				redirect: "error",
			});
		} catch {
			throw new Error(
				"Cannot reach device setup. Connect this computer to ClineDevice-XXXX and use the updated SDK firmware.",
			);
		}
		if (!response.ok)
			throw new Error(
				"Device setup failed. Check the device screen and reconnect to its setup Wi-Fi.",
			);
		return (await response.json()) as Record<string, unknown>;
	}
	async start(): Promise<DeviceSetupState> {
		if (this.session) throw new Error("Cancel the current device setup first.");
		const exchange = createECDH("prime256v1");
		const client = exchange.generateKeys();
		const reply = await this.post("/setup/start", {
			publicKey: client.toString("hex"),
		});
		if (
			typeof reply.publicKey !== "string" ||
			!/^04[0-9a-f]{128}$/.test(reply.publicKey) ||
			typeof reply.id !== "string" ||
			!/^[0-9a-f]{32}$/.test(reply.id)
		)
			throw new Error("Device returned an invalid setup handshake.");
		const device = Buffer.from(reply.publicKey, "hex");
		const key = createHash("sha256")
			.update(exchange.computeSecret(device))
			.update(client)
			.update(device)
			.digest();
		const code = String(
			createHash("sha256")
				.update(DEVICE_SETUP_CODE_CONTEXT)
				.update(key)
				.digest()
				.readUInt32BE(0) % 1000000,
		).padStart(6, "0");
		const state: DeviceSetupState = {
			status: "confirm",
			code,
			expiresAt: Date.now() + DEVICE_SETUP_TTL_MS,
		};
		this.session = { id: reply.id, key, state };
		this.expiryTimer = setTimeout(() => this.clear(), DEVICE_SETUP_TTL_MS);
		this.expiryTimer.unref();
		return { ...state };
	}
	async status(): Promise<DeviceSetupState> {
		const session = this.requireSession();
		const result = await this.post("/setup/status", { id: session.id });
		if (
			!["confirm", "approved", "rejected", "expired"].includes(
				String(result.status),
			)
		)
			throw new Error("Invalid device setup status.");
		session.state.status = result.status as DeviceSetupState["status"];
		return { ...session.state };
	}
	async save(
		settings: DeviceWifiSettings,
		pairingCode: string,
	): Promise<DeviceSetupState> {
		if (
			!settings ||
			typeof settings.ssid !== "string" ||
			Buffer.byteLength(settings.ssid) < 1 ||
			Buffer.byteLength(settings.ssid) > 32 ||
			typeof settings.password !== "string" ||
			Array.from(settings.ssid + settings.password).some(
				(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
			) ||
			Buffer.byteLength(settings.password) > 63 ||
			(settings.password.length > 0 && settings.password.length < 8) ||
			(settings.host !== undefined && typeof settings.host !== "string") ||
			(settings.host && !/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(settings.host))
		)
			throw new Error(
				"Check the Wi-Fi name, password, and optional LAN address.",
			);
		const state = await this.status();
		if (state.status !== "approved")
			throw new Error(
				"Confirm the matching code on the device before sending Wi-Fi settings.",
			);
		const session = this.requireSession();
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", session.key, iv);
		cipher.setAAD(Buffer.from(session.id));
		const plaintext = Buffer.from(
			JSON.stringify({
				ssid: settings.ssid,
				pass: settings.password,
				host: settings.host ?? "",
				code: pairingCode,
			}),
		);
		if (plaintext.length > DEVICE_SETUP_MAX_CONFIG_BYTES) {
			plaintext.fill(0);
			throw new Error("Wi-Fi settings are too long.");
		}
		let ciphertext: Buffer;
		try {
			ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		} finally {
			plaintext.fill(0);
		}
		await this.post("/setup/save", {
			id: session.id,
			iv: iv.toString("hex"),
			tag: cipher.getAuthTag().toString("hex"),
			data: ciphertext.toString("hex"),
		});
		const saved: DeviceSetupState = { ...state, status: "saved" };
		this.clear();
		return saved;
	}
	async cancel(): Promise<void> {
		const session = this.session;
		this.clear();
		if (session)
			await this.post("/setup/cancel", { id: session.id }).catch(() => {});
	}
	private requireSession() {
		if (!this.session) throw new Error("Start device setup first.");
		if (Date.now() >= this.session.state.expiresAt) {
			this.clear();
			throw new Error("Device setup expired. Start again.");
		}
		return this.session;
	}
	private clear() {
		clearTimeout(this.expiryTimer);
		this.expiryTimer = undefined;
		this.session?.key.fill(0);
		this.session = undefined;
	}
}
