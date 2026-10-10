import { createDecipheriv, createECDH, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DeviceProvisioning } from "./provisioning";

function device() {
	let state = "confirm";
	let key: Buffer;
	let code: string;
	let saved: unknown;
	const id = "ab".repeat(16);
	const requests: { path: string; body: Record<string, string> }[] = [];
	const fetcher = vi.fn(
		async (url: string | URL | Request, options?: RequestInit) => {
			const path = new URL(String(url)).pathname;
			const body = JSON.parse(String(options?.body));
			requests.push({ path, body });
			if (path === "/setup/start") {
				const device = createECDH("prime256v1");
				const publicKey = device.generateKeys();
				const client = Buffer.from(body.publicKey, "hex");
				key = createHash("sha256")
					.update(device.computeSecret(client))
					.update(client)
					.update(publicKey)
					.digest();
				code = String(
					createHash("sha256")
						.update("cline-setup-code-v1")
						.update(key)
						.digest()
						.readUInt32BE(0) % 1000000,
				).padStart(6, "0");
				return Response.json({ id, publicKey: publicKey.toString("hex") });
			}
			if (path === "/setup/status") return Response.json({ status: state });
			if (path === "/setup/cancel") {
				state = "rejected";
				return Response.json({});
			}
			if (path === "/setup/save") {
				if (state !== "approved") return Response.json({}, { status: 409 });
				const decipher = createDecipheriv(
					"aes-256-gcm",
					key,
					Buffer.from(body.iv, "hex"),
				);
				decipher.setAAD(Buffer.from(id));
				decipher.setAuthTag(Buffer.from(body.tag, "hex"));
				saved = JSON.parse(
					Buffer.concat([
						decipher.update(Buffer.from(body.data, "hex")),
						decipher.final(),
					]).toString(),
				);
				state = "saved";
				return Response.json({});
			}
			throw new Error("Unexpected path");
		},
	);
	return {
		provisioning: new DeviceProvisioning(fetcher as typeof fetch),
		requests,
		get code() {
			return code;
		},
		get saved() {
			return saved;
		},
		set status(value: string) {
			state = value;
		},
	};
}
const wifi = {
	ssid: "My Wi-Fi",
	password: "private-password",
	host: "192.168.1.5:25470",
};
describe("physical device provisioning", () => {
	it("derives matching codes and sends credentials only encrypted after physical approval", async () => {
		const d = device();
		const started = await d.provisioning.start();
		expect(started.code).toBe(d.code);
		expect(started.status).toBe("confirm");
		await expect(d.provisioning.save(wifi, "123456")).rejects.toThrow(
			"Confirm",
		);
		expect(d.requests.some((r) => r.path === "/setup/save")).toBe(false);
		d.status = "approved";
		expect((await d.provisioning.save(wifi, "123456")).status).toBe("saved");
		expect(d.saved).toEqual({
			ssid: wifi.ssid,
			pass: wifi.password,
			host: wifi.host,
			code: "123456",
		});
		expect(JSON.stringify(d.requests)).not.toContain(wifi.password);
		expect(JSON.stringify(d.requests)).not.toContain(wifi.ssid);
		await expect(d.provisioning.save(wifi, "123456")).rejects.toThrow(
			"Start device setup",
		);
	});
	it.each([
		"rejected",
		"expired",
	])("refuses credentials when device is %s", async (status) => {
		const d = device();
		await d.provisioning.start();
		d.status = status;
		await expect(d.provisioning.save(wifi, "123456")).rejects.toThrow(
			"Confirm",
		);
		expect(d.requests.some((r) => r.path === "/setup/save")).toBe(false);
	});
	it("cancels a pending setup and discards its keys", async () => {
		const d = device();
		await d.provisioning.start();
		await d.provisioning.cancel();
		await expect(d.provisioning.status()).rejects.toThrow("Start device setup");
		expect(d.requests.at(-1)?.path).toBe("/setup/cancel");
	});
	it("rejects malformed handshakes and never follows redirects", async () => {
		const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
			Response.json({ id: "bad", publicKey: "bad" }),
		);
		await expect(
			new DeviceProvisioning(fetcher as typeof fetch).start(),
		).rejects.toThrow("invalid setup handshake");
		expect(fetcher).toHaveBeenCalledWith(
			"http://192.168.4.1/setup/start",
			expect.objectContaining({ redirect: "error" }),
		);
	});
	it("rejects invalid Wi-Fi input without sending it to the device", async () => {
		const d = device();
		await d.provisioning.start();
		await expect(
			d.provisioning.save({ ...wifi, ssid: "x".repeat(33) }, "123456"),
		).rejects.toThrow("Wi-Fi name");
		expect(d.requests).toHaveLength(1);
	});
});
