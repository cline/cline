import { type ChildProcess, spawn } from "node:child_process";
import { createSocket, type Socket } from "node:dgram";
import { hostname, networkInterfaces } from "node:os";

export const SERVICE_TYPE = "_clinepet._tcp";
const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const TTL = 120;

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const TYPE_ANY = 255;
const CLASS_IN = 1;
const CACHE_FLUSH = 0x8000;

export interface MdnsAdvertisement {
	instance: string;
	port: number;
	txt: Record<string, string>;
}

export interface MdnsHandle {
	stop(): void;
}

export function lanIPv4Addresses(): string[] {
	const out: string[] = [];
	for (const addrs of Object.values(networkInterfaces())) {
		for (const a of addrs ?? []) {
			if (a.family === "IPv4" && !a.internal) out.push(a.address);
		}
	}
	return out;
}

/**
 * Advertise the bridge as `<instance>._clinepet._tcp.local`.
 * macOS already runs mDNSResponder on :5353, so register through `dns-sd`
 * there; elsewhere run a tiny built-in responder.
 */
export function advertise(ad: MdnsAdvertisement): MdnsHandle {
	if (process.platform === "darwin") return advertiseWithDnsSd(ad);
	return advertiseBuiltin(ad);
}

function advertiseWithDnsSd(ad: MdnsAdvertisement): MdnsHandle {
	const txt = Object.entries(ad.txt).map(([k, v]) => `${k}=${v}`);
	let child: ChildProcess | undefined = spawn(
		"dns-sd",
		["-R", ad.instance, SERVICE_TYPE, "local", String(ad.port), ...txt],
		{ stdio: "ignore" },
	);
	child.on("error", () => {
		child = undefined;
	});
	return {
		stop() {
			child?.kill();
			child = undefined;
		},
	};
}

// ---- Minimal RFC 6762 responder -------------------------------------------

function encodeName(name: string): Buffer {
	const parts = name.split(".").filter(Boolean);
	const bufs = parts.map((p) => {
		const label = Buffer.from(p, "utf8");
		return Buffer.concat([Buffer.from([label.length]), label]);
	});
	return Buffer.concat([...bufs, Buffer.from([0])]);
}

function record(
	name: string,
	type: number,
	cls: number,
	rdata: Buffer,
): Buffer {
	const head = Buffer.alloc(10);
	head.writeUInt16BE(type, 0);
	head.writeUInt16BE(cls, 2);
	head.writeUInt32BE(TTL, 4);
	head.writeUInt16BE(rdata.length, 8);
	return Buffer.concat([encodeName(name), head, rdata]);
}

/** Read a (possibly compressed) DNS name; returns [name, nextOffset]. */
export function readName(buf: Buffer, start: number): [string, number] {
	const labels: string[] = [];
	let offset = start;
	let next = -1;
	for (let hops = 0; hops < 32 && offset < buf.length; hops++) {
		const len = buf[offset];
		if (len === 0) {
			offset++;
			break;
		}
		if ((len & 0xc0) === 0xc0) {
			if (next < 0) next = offset + 2;
			offset = ((len & 0x3f) << 8) | buf[offset + 1];
			continue;
		}
		labels.push(buf.toString("utf8", offset + 1, offset + 1 + len));
		offset += 1 + len;
	}
	return [labels.join("."), next >= 0 ? next : offset];
}

export function parseQuestions(
	buf: Buffer,
): Array<{ name: string; type: number }> {
	if (buf.length < 12) return [];
	const flags = buf.readUInt16BE(2);
	if (flags & 0x8000) return []; // a response, not a query
	const count = buf.readUInt16BE(4);
	const out: Array<{ name: string; type: number }> = [];
	let offset = 12;
	for (let i = 0; i < count && offset < buf.length; i++) {
		const [name, next] = readName(buf, offset);
		if (next + 4 > buf.length) break;
		out.push({ name: name.toLowerCase(), type: buf.readUInt16BE(next) });
		offset = next + 4;
	}
	return out;
}

export function buildResponse(
	ad: MdnsAdvertisement,
	host: string,
	ips: string[],
): Buffer {
	const service = `${SERVICE_TYPE}.local`;
	const instance = `${ad.instance}.${service}`;
	const target = `${host}.local`;

	const srv = Buffer.alloc(6);
	srv.writeUInt16BE(0, 0);
	srv.writeUInt16BE(0, 2);
	srv.writeUInt16BE(ad.port, 4);
	const txt = Buffer.concat(
		Object.entries(ad.txt).map(([k, v]) => {
			const entry = Buffer.from(`${k}=${v}`, "utf8").subarray(0, 255);
			return Buffer.concat([Buffer.from([entry.length]), entry]);
		}),
	);
	const answers = [
		record(service, TYPE_PTR, CLASS_IN, encodeName(instance)),
		record(
			instance,
			TYPE_SRV,
			CLASS_IN | CACHE_FLUSH,
			Buffer.concat([srv, encodeName(target)]),
		),
		record(
			instance,
			TYPE_TXT,
			CLASS_IN | CACHE_FLUSH,
			txt.length ? txt : Buffer.from([0]),
		),
		...ips.map((ip) =>
			record(
				target,
				TYPE_A,
				CLASS_IN | CACHE_FLUSH,
				Buffer.from(ip.split(".").map(Number)),
			),
		),
	];
	const header = Buffer.alloc(12);
	header.writeUInt16BE(0x8400, 2); // response, authoritative
	header.writeUInt16BE(answers.length, 6);
	return Buffer.concat([header, ...answers]);
}

function advertiseBuiltin(ad: MdnsAdvertisement): MdnsHandle {
	const host = hostname()
		.replace(/\.local$/, "")
		.replace(/[^A-Za-z0-9-]/g, "-");
	const names = new Set(
		[
			`${SERVICE_TYPE}.local`,
			`${ad.instance}.${SERVICE_TYPE}.local`,
			`${host}.local`,
		].map((n) => n.toLowerCase()),
	);
	const socket: Socket = createSocket({ type: "udp4", reuseAddr: true });
	const send = () => {
		const ips = lanIPv4Addresses();
		if (ips.length === 0) return;
		socket.send(buildResponse(ad, host, ips), MDNS_PORT, MDNS_ADDR);
	};
	socket.on("message", (msg) => {
		const hit = parseQuestions(msg).some(
			(q) =>
				names.has(q.name) &&
				[TYPE_PTR, TYPE_SRV, TYPE_TXT, TYPE_A, TYPE_ANY].includes(q.type),
		);
		if (hit) send();
	});
	socket.on("error", () => socket.close());
	socket.bind(MDNS_PORT, () => {
		try {
			socket.addMembership(MDNS_ADDR);
			socket.setMulticastTTL(255);
		} catch {
			// No multicast-capable interface; discovery falls back to manual IP.
		}
		send();
		setTimeout(send, 1000);
	});
	return {
		stop() {
			try {
				socket.close();
			} catch {
				// already closed
			}
		},
	};
}
