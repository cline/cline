export interface DeviceServiceStatus {
	service: "cline-device-service";
	hubUrl: string;
	hubConnected: boolean;
	deviceEndpoint: string;
	browserEndpoint?: string;
	devices: string[];
}

/** Validate public device health status. No credentials or pairing codes. */
export function parseDeviceServiceStatus(
	value: unknown,
): DeviceServiceStatus | undefined {
	if (!value || typeof value !== "object") return;
	const data = value as Record<string, unknown>;
	const validUrl = (value: unknown, protocols: string[]) => {
		try {
			return (
				typeof value === "string" && protocols.includes(new URL(value).protocol)
			);
		} catch {
			return false;
		}
	};
	if (
		data.service !== "cline-device-service" ||
		!validUrl(data.hubUrl, ["ws:", "wss:"]) ||
		typeof data.hubConnected !== "boolean" ||
		!validUrl(data.deviceEndpoint, ["ws:", "wss:"]) ||
		(data.browserEndpoint !== undefined &&
			!validUrl(data.browserEndpoint, ["http:", "https:"])) ||
		!Array.isArray(data.devices) ||
		!data.devices.every((name) => typeof name === "string")
	)
		return;
	return {
		service: "cline-device-service",
		hubUrl: data.hubUrl as string,
		hubConnected: data.hubConnected,
		deviceEndpoint: data.deviceEndpoint as string,
		browserEndpoint: data.browserEndpoint as string | undefined,
		devices: data.devices as string[],
	};
}
