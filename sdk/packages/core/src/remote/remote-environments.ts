import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
	access,
	chmod,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";
import { requestHubShutdown } from "../hub/client";

export interface RemoteEnvironmentProfile {
	id: string;
	name: string;
	host: string;
	user?: string;
	port?: number;
	identityFile?: string;
	createdAt: string;
	updatedAt: string;
}

export interface RemoteEnvironmentInput {
	id?: string;
	name: string;
	host: string;
	user?: string;
	port?: number;
	identityFile?: string;
}

export type RemoteEnvironmentState =
	| "disconnected"
	| "testing"
	| "available"
	| "connecting"
	| "connected"
	| "error";

export interface RemoteEnvironmentStatus {
	profileId: string;
	state: RemoteEnvironmentState;
	updatedAt: string;
	message?: string;
	remotePlatform?: "linux" | "darwin";
	remoteArch?: "x64" | "arm64";
	remoteHome?: string;
}

export interface RemoteEnvironmentConnection {
	profile: RemoteEnvironmentProfile;
	profileId: string;
	state: "connected";
	endpoint: string;
	authToken: string;
	workspaceRoot: string;
	homeDir: string;
	platform: "linux" | "darwin";
	arch: "x64" | "arm64";
	remoteHubUrl: string;
	localPort: number;
	connectedAt: string;
}

export interface RemoteCommandInput {
	command: string;
	args: string[];
	cwd?: string;
}

export interface RemoteCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface RemoteHelperTarget {
	platform: "linux" | "darwin";
	arch: "x64" | "arm64";
}

export interface RemoteTunnelProcess {
	readonly pid?: number;
	readonly exitCode: number | null;
	kill(signal?: NodeJS.Signals): boolean;
	once(
		event: "exit",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	once(event: "error", listener: (error: Error) => void): unknown;
}

export interface RemoteProcessOptions {
	timeoutMs: number;
	inputFile?: string;
	/** Combined stdout/stderr limit; defaults to 8 MiB. */
	maxOutputBytes?: number;
}

interface RemoteInspection extends RemoteHelperTarget {
	home: string;
}

export interface RemoteEnvironmentDependencies {
	runProcess(
		executable: string,
		args: string[],
		options: RemoteProcessOptions,
	): Promise<RemoteCommandResult>;
	spawnTunnel(executable: string, args: string[]): RemoteTunnelProcess;
	waitForTunnel(
		port: number,
		tunnel: RemoteTunnelProcess,
		timeoutMs: number,
	): Promise<void>;
	reservePort(): Promise<number>;
	hashFile(path: string): Promise<string>;
	resolveHelperBinary(target: RemoteHelperTarget): Promise<string | undefined>;
	fileReadable(path: string): Promise<boolean>;
	requestHubShutdown(url: string, authToken?: string): Promise<boolean>;
	now(): Date;
	randomId(): string;
}

export interface RemoteEnvironmentServiceOptions {
	profilesPath?: string;
	sshPath?: string;
	knownHostsPath?: string;
	connectTimeoutSeconds?: number;
	commandTimeoutMs?: number;
	uploadTimeoutMs?: number;
	tunnelTimeoutMs?: number;
	hubShutdownTimeoutMs?: number;
	helperBinaryPath?: string;
	helperBinaryDirectory?: string;
	env?: NodeJS.ProcessEnv;
	onStatusChange?: (status: RemoteEnvironmentStatus) => void;
	onConnectionLost?: (status: RemoteEnvironmentStatus) => void;
	dependencies?: Partial<RemoteEnvironmentDependencies>;
}

interface ProfilesFile {
	version: 1;
	profiles: RemoteEnvironmentProfile[];
}

interface PendingHubCleanup {
	profile: RemoteEnvironmentProfile;
	helper: string;
	discoveryPath: string;
}

interface ManagedConnection {
	cleanup: PendingHubCleanup;
	connection: RemoteEnvironmentConnection;
	tunnel: RemoteTunnelProcess;
}

const PROFILE_FILE_VERSION = 1;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_TUNNEL_TIMEOUT_MS = 10_000;
const DEFAULT_HUB_SHUTDOWN_TIMEOUT_MS = 2_000;
const REMOTE_HELPER_DIRECTORY = ".cline/remote";
const REMOTE_DISCOVERY_DIRECTORY = ".cline/data/remote";
const REMOTE_INSPECTION_SENTINEL = "CLINE_REMOTE_INSPECT_V1";

export class RemoteEnvironmentService {
	private readonly profilesPath: string;
	private readonly ownerId = randomUUID();
	private readonly sshPath: string;
	private readonly knownHostsPath?: string;
	private readonly connectTimeoutSeconds: number;
	private readonly commandTimeoutMs: number;
	private readonly uploadTimeoutMs: number;
	private readonly tunnelTimeoutMs: number;
	private readonly hubShutdownTimeoutMs: number;
	private readonly dependencies: RemoteEnvironmentDependencies;
	private readonly onStatusChange?: (status: RemoteEnvironmentStatus) => void;
	private readonly onConnectionLost?: (status: RemoteEnvironmentStatus) => void;
	private readonly statuses = new Map<string, RemoteEnvironmentStatus>();
	private readonly connections = new Map<string, ManagedConnection>();
	private activeProfileId: string | undefined;
	private mutationTail: Promise<void> = Promise.resolve();

	public constructor(options: RemoteEnvironmentServiceOptions = {}) {
		const env = options.env ?? process.env;
		const configuredHelper =
			options.helperBinaryPath ?? env.CLINE_REMOTE_HELPER_BINARY;
		const configuredHelperDirectory =
			options.helperBinaryDirectory ?? env.CLINE_REMOTE_HELPER_DIRECTORY;
		const defaults = createDefaultDependencies(
			configuredHelper,
			configuredHelperDirectory,
		);

		this.profilesPath =
			options.profilesPath ??
			join(resolveClineDataDir(), "settings", "remote-environments.json");
		this.sshPath = options.sshPath ?? env.CLINE_SSH_PATH ?? "ssh";
		this.knownHostsPath =
			options.knownHostsPath ?? env.CLINE_SSH_KNOWN_HOSTS_FILE;
		this.connectTimeoutSeconds =
			options.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS;
		this.commandTimeoutMs =
			options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
		this.uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
		this.tunnelTimeoutMs = options.tunnelTimeoutMs ?? DEFAULT_TUNNEL_TIMEOUT_MS;
		this.hubShutdownTimeoutMs =
			options.hubShutdownTimeoutMs ?? DEFAULT_HUB_SHUTDOWN_TIMEOUT_MS;
		this.onStatusChange = options.onStatusChange;
		this.onConnectionLost = options.onConnectionLost;
		this.dependencies = { ...defaults, ...options.dependencies };
	}

	public async list(): Promise<RemoteEnvironmentProfile[]> {
		const profiles = await this.readProfiles();
		return profiles
			.map((profile) => ({ ...profile }))
			.sort(
				(left, right) =>
					left.name.localeCompare(right.name) ||
					left.id.localeCompare(right.id),
			);
	}

	public async upsert(
		input: RemoteEnvironmentInput,
	): Promise<RemoteEnvironmentProfile> {
		return this.withMutation(async () => {
			const normalized = normalizeInput(input);
			const profiles = await this.readProfiles();
			const existingIndex = input.id
				? profiles.findIndex((profile) => profile.id === input.id)
				: -1;
			const now = this.dependencies.now().toISOString();
			const existing = existingIndex >= 0 ? profiles[existingIndex] : undefined;
			if (existing) {
				assertProfileUpdateAllowed(
					existing,
					normalized,
					this.connections.has(existing.id),
				);
			}
			const profile: RemoteEnvironmentProfile = {
				...normalized,
				id: existing?.id ?? normalized.id ?? this.dependencies.randomId(),
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			};

			if (existingIndex >= 0) {
				profiles[existingIndex] = profile;
			} else {
				profiles.push(profile);
			}
			await this.writeProfiles(profiles);
			const connected = this.connections.get(profile.id);
			if (
				connected &&
				profilesUseSameConnection(connected.connection.profile, profile)
			) {
				connected.connection = {
					...connected.connection,
					profile: { ...profile },
				};
			}
			return { ...profile };
		});
	}

	public async delete(id: string): Promise<boolean> {
		return this.withMutation(async () => {
			const profiles = await this.readProfiles();
			const remaining = profiles.filter((profile) => profile.id !== id);
			if (remaining.length === profiles.length) {
				return false;
			}

			await this.disconnectProfile(id);
			await this.writeProfiles(remaining);
			this.statuses.delete(id);
			return true;
		});
	}

	public async test(id: string): Promise<RemoteEnvironmentStatus> {
		const profile = await this.requireProfile(id);
		this.setStatus(id, "testing", "Testing SSH connection");
		try {
			const inspection = await this.inspectRemote(profile);
			return this.setStatus(
				id,
				"available",
				"SSH connection succeeded",
				inspection,
			);
		} catch (error) {
			return this.setStatus(id, "error", errorMessage(error));
		}
	}

	public connect(id: string): Promise<RemoteEnvironmentConnection> {
		return this.withMutation(() => this.connectProfile(id));
	}

	private async connectProfile(
		id: string,
	): Promise<RemoteEnvironmentConnection> {
		const profile = await this.requireProfile(id);
		// upsert() rejects host/user/port changes via assertProfileUpdateAllowed,
		// even while disconnected. A different destination needs a new profile,
		// so editing this profile cannot redirect it while old cleanup is pending.
		// Finish cleanup before starting another Hub; retries use the current SSH key.
		await this.retryPendingCleanup(id);
		const previousManaged = this.connections.get(id);
		const current = previousManaged?.connection;
		if (current && profilesUseSameConnection(current.profile, profile)) {
			this.activeProfileId = id;
			return { ...current, profile: { ...current.profile } };
		}

		this.setStatus(id, "connecting", "Connecting to remote environment");
		let bootstrap: { helper: string; discoveryPath: string } | undefined;
		let pendingTunnel: RemoteTunnelProcess | undefined;
		try {
			const inspection = await this.inspectRemote(profile);
			await this.validateDirectory(profile, inspection.home);
			const remoteHelper = await this.ensureHelper(profile, inspection);

			const discoveryPath = joinRemote(
				inspection.home,
				`${REMOTE_DISCOVERY_DIRECTORY}/${this.ownerId}-${createHash("sha256").update(profile.id).digest("hex").slice(0, 16)}.json`,
			);
			bootstrap = { helper: remoteHelper, discoveryPath };
			const ensureResult = await this.execRemote(profile, {
				command: remoteHelper,
				args: [
					"--remote-hub-ensure",
					"--cwd",
					inspection.home,
					"--discovery-path",
					discoveryPath,
				],
			});
			const hub = parseRemoteHubResult(ensureResult.stdout);
			const localPort = await this.dependencies.reservePort();
			const tunnel = this.dependencies.spawnTunnel(
				this.sshPath,
				this.buildTunnelArgs(profile, localPort, hub.port),
			);
			pendingTunnel = tunnel;

			await this.dependencies.waitForTunnel(
				localPort,
				tunnel,
				this.tunnelTimeoutMs,
			);

			const connectedAt = this.dependencies.now().toISOString();
			const connection: RemoteEnvironmentConnection = {
				profile: { ...profile },
				profileId: id,
				state: "connected",
				endpoint: `ws://127.0.0.1:${localPort}${hub.pathname}`,
				authToken: hub.authToken,
				workspaceRoot: inspection.home,
				homeDir: inspection.home,
				platform: inspection.platform,
				arch: inspection.arch,
				remoteHubUrl: `ws://127.0.0.1:${hub.port}${hub.pathname}`,
				localPort,
				connectedAt,
			};
			const managed = {
				connection,
				tunnel,
				cleanup: { profile, helper: remoteHelper, discoveryPath },
			};
			this.connections.set(id, managed);
			this.activeProfileId = id;
			this.setStatus(id, "connected", "Connected", inspection);
			tunnel.once("exit", () =>
				this.handleTunnelEnd(id, managed, "SSH tunnel exited"),
			);
			tunnel.once("error", (error) =>
				this.handleTunnelEnd(id, managed, error.message),
			);
			if (previousManaged && previousManaged !== managed) {
				const sameHub =
					previousManaged.connection.authToken === connection.authToken &&
					previousManaged.connection.remoteHubUrl === connection.remoteHubUrl;
				if (!sameHub) {
					await this.stopManagedHub(previousManaged);
				}
				previousManaged.tunnel.kill("SIGTERM");
			}
			bootstrap = undefined;
			pendingTunnel = undefined;
			return { ...connection, profile: { ...connection.profile } };
		} catch (error) {
			pendingTunnel?.kill("SIGTERM");
			let cleanupError: unknown;
			if (bootstrap) {
				try {
					// An independent SSH command works even when forwarding never opened.
					await this.execRemote(profile, {
						command: bootstrap.helper,
						args: [
							"--remote-hub-stop",
							"--discovery-path",
							bootstrap.discoveryPath,
						],
					});
				} catch (failure) {
					cleanupError = failure;
					await this.persistPendingCleanup({ profile, ...bootstrap });
				}
			}
			if (cleanupError) {
				const failure = new Error(
					`${errorMessage(error)}; remote Hub cleanup failed: ${errorMessage(cleanupError)}`,
					{ cause: error },
				);
				this.setStatus(id, "error", failure.message);
				throw failure;
			}
			this.setStatus(id, "error", errorMessage(error));
			throw error;
		}
	}

	public disconnect(id?: string): Promise<boolean> {
		return this.withMutation(() => this.disconnectProfile(id));
	}

	private async disconnectProfile(id?: string): Promise<boolean> {
		const targetId = id ?? this.activeProfileId;
		if (!targetId) {
			return false;
		}
		const managed = this.connections.get(targetId);
		if (!managed) {
			await this.retryPendingCleanup(targetId);
			if (this.activeProfileId === targetId) {
				this.activeProfileId = undefined;
			}
			return false;
		}

		this.connections.delete(targetId);
		if (this.activeProfileId === targetId) {
			this.activeProfileId = undefined;
		}
		await this.stopManagedHub(managed);
		managed.tunnel.kill("SIGTERM");
		this.setStatus(targetId, "disconnected", "Disconnected");
		return true;
	}

	public getActive(): RemoteEnvironmentConnection | undefined {
		if (!this.activeProfileId) {
			return undefined;
		}
		return this.getConnection(this.activeProfileId);
	}

	public getConnection(id: string): RemoteEnvironmentConnection | undefined {
		const connection = this.connections.get(id)?.connection;
		return connection
			? { ...connection, profile: { ...connection.profile } }
			: undefined;
	}

	/**
	 * Marks an already-established tunnel as active without doing any SSH work.
	 * A client uses this to roll back a host switch when the
	 * new Hub runtime cannot be initialized.
	 */
	public activateConnection(id: string): boolean {
		if (!this.connections.has(id)) {
			return false;
		}
		this.activeProfileId = id;
		return true;
	}

	public getStatuses(): RemoteEnvironmentStatus[] {
		return [...this.statuses.values()]
			.map((status) => ({ ...status }))
			.sort((left, right) => left.profileId.localeCompare(right.profileId));
	}

	public async run(
		id: string,
		input: RemoteCommandInput,
	): Promise<RemoteCommandResult> {
		const profile = await this.requireProfile(id);
		validateCommandInput(input);
		let cwd = input.cwd;
		if (!cwd) {
			cwd = this.connections.get(id)?.connection.workspaceRoot;
		}
		if (cwd) {
			const home =
				this.connections.get(id)?.connection.homeDir ??
				(await this.inspectRemote(profile)).home;
			cwd = resolveRemotePath(cwd, home);
		}
		return this.execRemote(profile, { ...input, cwd });
	}

	public dispose(): Promise<void> {
		return this.withMutation(async () => {
			for (const id of [...this.connections.keys()]) {
				await this.disconnectProfile(id);
			}
			await this.retryPendingCleanup();
		});
	}

	private async ensureHelper(
		profile: RemoteEnvironmentProfile,
		inspection: RemoteInspection,
	): Promise<string> {
		const localHelper = await this.dependencies.resolveHelperBinary(inspection);
		if (!localHelper || !(await this.dependencies.fileReadable(localHelper))) {
			throw new Error(
				`Remote target ${inspection.platform}/${inspection.arch} is unsupported in SSH: ` +
					"no compatible remote helper binary is available. Build the matching core remote helper and set " +
					"CLINE_REMOTE_HELPER_BINARY; network installers are intentionally not used.",
			);
		}

		const hash = await this.dependencies.hashFile(localHelper);
		const remoteDirectory = joinRemote(
			inspection.home,
			REMOTE_HELPER_DIRECTORY,
		);
		const remoteHelper = joinRemote(
			remoteDirectory,
			`cline-remote-helper-${inspection.platform}-${inspection.arch}-${hash.slice(0, 16)}`,
		);
		await this.installHelper(
			profile,
			localHelper,
			remoteDirectory,
			remoteHelper,
		);
		return remoteHelper;
	}

	private async installHelper(
		profile: RemoteEnvironmentProfile,
		localHelper: string,
		remoteDirectory: string,
		remoteHelper: string,
	): Promise<void> {
		const existing = await this.execRemoteAllowFailure(profile, {
			command: "test",
			args: ["-x", remoteHelper],
		});
		if (existing.exitCode === 0) {
			return;
		}

		await this.execRemote(profile, {
			command: "mkdir",
			args: ["-p", remoteDirectory],
		});
		await this.execRemote(profile, {
			command: "chmod",
			args: ["700", remoteDirectory],
		});
		const temporaryPath = `${remoteHelper}.upload-${this.dependencies.randomId()}`;
		const uploadCommand = `umask 077; cat > ${shellQuote(temporaryPath)}`;
		const upload = await this.dependencies.runProcess(
			this.sshPath,
			[...this.buildSshArgs(profile), this.destination(profile), uploadCommand],
			{ timeoutMs: this.uploadTimeoutMs, inputFile: localHelper },
		);
		if (upload.exitCode !== 0) {
			throw processFailure("upload remote helper", upload);
		}
		try {
			await this.execRemote(profile, {
				command: "chmod",
				args: ["700", temporaryPath],
			});
			await this.execRemote(profile, {
				command: "mv",
				args: ["-f", temporaryPath, remoteHelper],
			});
		} catch (error) {
			await this.execRemoteAllowFailure(profile, {
				command: "rm",
				args: ["-f", temporaryPath],
			});
			throw error;
		}
	}

	private async stopManagedHub(managed: ManagedConnection): Promise<void> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.dependencies
					.requestHubShutdown(
						managed.connection.endpoint,
						managed.connection.authToken,
					)
					.catch(() => false),
				new Promise<boolean>((resolve) => {
					timeout = setTimeout(() => resolve(false), this.hubShutdownTimeoutMs);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private async inspectRemote(
		profile: RemoteEnvironmentProfile,
	): Promise<RemoteInspection> {
		const script =
			`printf '\\000${REMOTE_INSPECTION_SENTINEL}\\000%s\\000%s\\000%s\\000' ` +
			'"$(uname -s)" "$(uname -m)" "$HOME"';
		const result = await this.execRemote(profile, {
			command: "sh",
			args: ["-c", script],
		});
		const fields = result.stdout.split("\0");
		const sentinelIndex = fields.lastIndexOf(REMOTE_INSPECTION_SENTINEL);
		const rawPlatform = fields[sentinelIndex + 1];
		const rawArch = fields[sentinelIndex + 2];
		const home = fields[sentinelIndex + 3] ?? "";
		if (sentinelIndex < 0 || fields[sentinelIndex + 4] !== "") {
			throw new Error("The SSH host returned an invalid inspection payload");
		}
		const platform = normalizePlatform(rawPlatform?.trim());
		const arch = normalizeArch(rawArch?.trim());
		if (!platform || !arch) {
			throw new Error(
				`Remote target ${rawPlatform || "unknown"}/${rawArch || "unknown"} is unsupported in SSH; ` +
					"only Linux and macOS on x64 or arm64 are supported.",
			);
		}
		if (!home.startsWith("/") || /[\0\r\n]/.test(home)) {
			throw new Error("The SSH host returned an invalid HOME directory");
		}
		return { platform, arch, home };
	}

	private async validateDirectory(
		profile: RemoteEnvironmentProfile,
		directory: string,
	): Promise<void> {
		const result = await this.execRemoteAllowFailure(profile, {
			command: "test",
			args: ["-d", directory],
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`Remote directory does not exist or is not a directory: ${directory}`,
			);
		}
	}

	private async execRemote(
		profile: RemoteEnvironmentProfile,
		input: RemoteCommandInput,
	): Promise<RemoteCommandResult> {
		const result = await this.execRemoteAllowFailure(profile, input);
		if (result.exitCode !== 0) {
			throw processFailure(`run remote command ${input.command}`, result);
		}
		return result;
	}

	private async execRemoteAllowFailure(
		profile: RemoteEnvironmentProfile,
		input: RemoteCommandInput,
	): Promise<RemoteCommandResult> {
		validateCommandInput(input);
		const command = buildRemoteCommand(input.command, input.args, input.cwd);
		return this.dependencies.runProcess(
			this.sshPath,
			[...this.buildSshArgs(profile), this.destination(profile), command],
			{ timeoutMs: this.commandTimeoutMs },
		);
	}

	private buildSshArgs(profile: RemoteEnvironmentProfile): string[] {
		const args = [
			"-o",
			"BatchMode=yes",
			"-o",
			`ConnectTimeout=${this.connectTimeoutSeconds}`,
			"-o",
			"StrictHostKeyChecking=yes",
		];
		if (profile.port) {
			args.push("-p", String(profile.port));
		}
		if (this.knownHostsPath) {
			args.push("-o", `UserKnownHostsFile=${this.knownHostsPath}`);
		}
		if (profile.identityFile) {
			args.push("-i", expandLocalHome(profile.identityFile));
		}
		return args;
	}

	private buildTunnelArgs(
		profile: RemoteEnvironmentProfile,
		localPort: number,
		remotePort: number,
	): string[] {
		return [
			...this.buildSshArgs(profile),
			"-N",
			"-o",
			"ExitOnForwardFailure=yes",
			"-o",
			"ServerAliveInterval=15",
			"-o",
			"ServerAliveCountMax=3",
			"-L",
			`127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
			this.destination(profile),
		];
	}

	private destination(profile: RemoteEnvironmentProfile): string {
		return profile.user ? `${profile.user}@${profile.host}` : profile.host;
	}

	private async requireProfile(id: string): Promise<RemoteEnvironmentProfile> {
		const profile = (await this.readProfiles()).find(
			(candidate) => candidate.id === id,
		);
		if (!profile) {
			throw new Error(`Remote environment profile not found: ${id}`);
		}
		return profile;
	}

	private setStatus(
		profileId: string,
		state: RemoteEnvironmentState,
		message?: string,
		inspection?: RemoteInspection,
	): RemoteEnvironmentStatus {
		const status: RemoteEnvironmentStatus = {
			profileId,
			state,
			updatedAt: this.dependencies.now().toISOString(),
			...(message ? { message } : {}),
			...(inspection
				? {
						remotePlatform: inspection.platform,
						remoteArch: inspection.arch,
						remoteHome: inspection.home,
					}
				: {}),
		};
		this.statuses.set(profileId, status);
		const snapshot = { ...status };
		this.onStatusChange?.(snapshot);
		return snapshot;
	}

	private handleTunnelEnd(
		id: string,
		managed: ManagedConnection,
		message: string,
	): void {
		if (this.connections.get(id) !== managed) {
			return;
		}
		this.connections.delete(id);
		if (this.activeProfileId === id) {
			this.activeProfileId = undefined;
		}
		// Persist before retrying: network loss can outlive this client process.
		void this.withMutation(async () => {
			await this.persistPendingCleanup(managed.cleanup);
			await this.retryPendingCleanup(id);
		}).catch((error) =>
			this.setStatus(
				id,
				"error",
				`${message}; remote Hub cleanup pending: ${errorMessage(error)}`,
			),
		);
		const status = this.setStatus(id, "error", message);
		this.onConnectionLost?.(status);
	}

	private async persistPendingCleanup(
		cleanup: PendingHubCleanup,
	): Promise<void> {
		const directory = `${this.profilesPath}.cleanup`;
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const key = createHash("sha256")
			.update(cleanup.discoveryPath)
			.digest("hex");
		const path = join(directory, `${key}.json`);
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, JSON.stringify(cleanup), { mode: 0o600 });
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}

	private async retryPendingCleanup(profileId?: string): Promise<void> {
		const directory = `${this.profilesPath}.cleanup`;
		let files: string[];
		try {
			files = await readdir(directory);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") return;
			throw error;
		}
		const profiles = await this.readProfiles();
		for (const file of files.filter((file) => file.endsWith(".json"))) {
			const path = join(directory, file);
			const cleanup: PendingHubCleanup = JSON.parse(
				await readFile(path, "utf8"),
			);
			if (profileId && cleanup.profile.id !== profileId) continue;
			// An identity-file edit is allowed while disconnected; destination edits
			// are rejected by assertProfileUpdateAllowed. Use the current credentials
			// for retries, but still verify the destination before reusing them from
			// persisted state (the profile may have been removed or the file edited).
			const profile = profiles.find(
				(profile) =>
					profile.id === cleanup.profile.id &&
					profile.host === cleanup.profile.host &&
					profile.user === cleanup.profile.user &&
					profile.port === cleanup.profile.port,
			);
			const cleanupProfile = profile ?? cleanup.profile;
			const available = await this.execRemoteAllowFailure(cleanupProfile, {
				command: "test",
				args: ["-x", cleanup.helper],
			});
			// Cache removal must not strand the durable cleanup record. Restore
			// a compatible helper, still targeting the original owned discovery.
			const helper =
				available.exitCode === 0
					? cleanup.helper
					: await this.ensureHelper(
							cleanupProfile,
							await this.inspectRemote(cleanupProfile),
						);
			await this.execRemote(cleanupProfile, {
				command: helper,
				args: ["--remote-hub-stop", "--discovery-path", cleanup.discoveryPath],
			});
			await rm(path, { force: true });
		}
	}

	private async readProfiles(): Promise<RemoteEnvironmentProfile[]> {
		let raw: string;
		try {
			raw = await readFile(this.profilesPath, "utf8");
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(
				`Failed to parse remote environment profiles at ${this.profilesPath}`,
				{ cause: error },
			);
		}
		if (!isProfilesFile(parsed)) {
			throw new Error(
				`Invalid remote environment profiles file at ${this.profilesPath}`,
			);
		}
		return parsed.profiles.map((profile) => ({ ...profile }));
	}

	private async writeProfiles(
		profiles: RemoteEnvironmentProfile[],
	): Promise<void> {
		const directory = dirname(this.profilesPath);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const temporaryPath = join(
			directory,
			`.${this.dependencies.randomId()}.remote-environments.tmp`,
		);
		const payload: ProfilesFile = { version: PROFILE_FILE_VERSION, profiles };
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(temporaryPath, "wx", 0o600);
			await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
			await handle.sync();
			await handle.close();
			handle = undefined;
			await rename(temporaryPath, this.profilesPath);
			await chmod(this.profilesPath, 0o600);
		} catch (error) {
			await handle?.close().catch(() => undefined);
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	private withMutation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutationTail.then(operation, operation);
		this.mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

function createDefaultDependencies(
	configuredHelper?: string,
	configuredHelperDirectory?: string,
): RemoteEnvironmentDependencies {
	return {
		runProcess: runRemoteProcess,
		spawnTunnel: (executable, args) =>
			spawn(executable, args, { stdio: "ignore" }),
		waitForTunnel,
		reservePort,
		hashFile,
		resolveHelperBinary: async (target) => {
			if (configuredHelper) {
				return configuredHelper;
			}
			const filename = remoteHelperBinaryFilename(target);
			const executableDirectory = dirname(process.execPath);
			const candidates = [
				...(configuredHelperDirectory
					? [join(configuredHelperDirectory, filename)]
					: []),
				join(executableDirectory, "remote-helpers", filename),
			];
			for (const candidate of candidates) {
				try {
					await access(candidate, constants.R_OK);
					return candidate;
				} catch {
					// Try the next packaged/development resource location.
				}
			}
			return undefined;
		},
		fileReadable: async (path) => {
			try {
				await access(path, constants.R_OK);
				return true;
			} catch {
				return false;
			}
		},
		requestHubShutdown,
		now: () => new Date(),
		randomId: randomUUID,
	};
}

export function remoteHelperBinaryFilename(target: RemoteHelperTarget): string {
	const triple =
		target.platform === "darwin"
			? target.arch === "arm64"
				? "aarch64-apple-darwin"
				: "x86_64-apple-darwin"
			: target.arch === "arm64"
				? "aarch64-unknown-linux-gnu"
				: "x86_64-unknown-linux-gnu";
	return `cline-remote-helper-${triple}`;
}

export async function runRemoteProcess(
	executable: string,
	args: string[],
	options: RemoteProcessOptions,
): Promise<RemoteCommandResult> {
	const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1)
		throw new Error("maxOutputBytes must be a positive integer");
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			stdio: [options.inputFile ? "pipe" : "ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		let failure: Error | undefined;
		let input: ReturnType<typeof createReadStream> | undefined;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const stopInput = () => {
			input?.destroy();
			child.stdin?.destroy();
		};
		const signalTree = (signal: NodeJS.Signals) => {
			if (!child.pid) return;
			if (process.platform === "win32") {
				// taskkill includes ProxyCommand descendants; child.kill alone does not.
				const killer = spawn(
					"taskkill",
					["/pid", String(child.pid), "/T", "/F"],
					{ stdio: "ignore" },
				);
				killer.on("error", () => child.kill(signal));
			} else {
				try {
					process.kill(-child.pid, signal);
				} catch {
					child.kill(signal);
				}
			}
		};
		const finish = (error?: Error, code?: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(escalation);
			clearTimeout(deadline);
			stopInput();
			child.stdout?.destroy();
			child.stderr?.destroy();
			if (error) reject(error);
			else
				resolve({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					exitCode: code ?? 1,
				});
		};
		const terminate = (error: Error) => {
			if (settled || failure) return;
			failure = error;
			stopInput();
			signalTree("SIGTERM");
			escalation = setTimeout(() => {
				signalTree("SIGKILL");
				// An inherited pipe must not keep cleanup waiting forever.
				deadline = setTimeout(() => finish(failure), 500);
			}, 500);
		};
		const timer = setTimeout(
			() =>
				terminate(
					new Error(`${executable} timed out after ${options.timeoutMs}ms`),
				),
			options.timeoutMs,
		);
		const capture = (target: Buffer[], chunk: Buffer) => {
			if (settled || failure) return;
			bytes += chunk.length;
			if (bytes > maxOutputBytes) {
				terminate(
					new Error(`${executable} output exceeded ${maxOutputBytes} bytes`),
				);
				return;
			}
			target.push(chunk);
		};
		child.stdout?.on("data", (chunk: Buffer) => capture(stdout, chunk));
		child.stderr?.on("data", (chunk: Buffer) => capture(stderr, chunk));
		child.once("error", (error) => terminate(error));
		// Drain late ProxyCommand diagnostics before resolving a successful command.
		child.once("close", (code, signal) =>
			finish(
				failure ??
					(signal
						? new Error(`${executable} exited from signal ${signal}`)
						: undefined),
				code ?? 1,
			),
		);
		if (options.inputFile && child.stdin) {
			input = createReadStream(options.inputFile);
			child.stdin.once("error", terminate);
			input.once("error", terminate);
			input.pipe(child.stdin);
		}
	});
}

async function reservePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Failed to reserve a local port for the SSH tunnel"));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});
}

async function waitForTunnel(
	port: number,
	tunnel: RemoteTunnelProcess,
	timeoutMs: number,
): Promise<void> {
	let tunnelFailure: Error | undefined;
	tunnel.once("error", (error) => {
		tunnelFailure = new Error(`Failed to start SSH tunnel: ${error.message}`, {
			cause: error,
		});
	});
	tunnel.once("exit", (code, signal) => {
		tunnelFailure = new Error(
			`SSH tunnel exited before it became ready (${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`})`,
		);
	});
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (tunnelFailure) {
			throw tunnelFailure;
		}
		if (tunnel.exitCode !== null) {
			throw new Error(
				`SSH tunnel exited before it became ready (exit ${tunnel.exitCode})`,
			);
		}
		if (await canConnect(port)) {
			return;
		}
		await delay(50);
	}
	throw new Error(`SSH tunnel did not become ready within ${timeoutMs}ms`);
}

async function canConnect(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		const finish = (result: boolean): void => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(250);
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.once("timeout", () => finish(false));
	});
}

async function hashFile(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(path);
		stream.once("error", reject);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.once("end", () => resolve(hash.digest("hex")));
	});
}

function normalizeInput(input: RemoteEnvironmentInput): Omit<
	RemoteEnvironmentProfile,
	"id" | "createdAt" | "updatedAt"
> & {
	id?: string;
} {
	const name = input.name.trim();
	const host = input.host.trim();
	const user = input.user?.trim() || undefined;
	const identityFile = input.identityFile?.trim() || undefined;
	if (!name) {
		throw new Error("Remote environment name is required");
	}
	if (!host || host.startsWith("-") || /[\s\0]/.test(host)) {
		throw new Error(
			"SSH host must be a hostname, address, or SSH config alias without whitespace",
		);
	}
	if (user && (!/^[A-Za-z0-9._-]+$/.test(user) || user.startsWith("-"))) {
		throw new Error("SSH user contains unsupported characters");
	}
	if (
		input.port !== undefined &&
		(!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535)
	) {
		throw new Error("SSH port must be an integer between 1 and 65535");
	}
	if (identityFile && /[\0\r\n]/.test(identityFile)) {
		throw new Error("SSH identity file cannot contain newlines or NUL bytes");
	}
	if (input.id && /[\0\r\n]/.test(input.id)) {
		throw new Error("Remote environment id is invalid");
	}
	return {
		id: input.id,
		name,
		host,
		...(user ? { user } : {}),
		...(input.port ? { port: input.port } : {}),
		...(identityFile ? { identityFile } : {}),
	};
}

function profilesUseSameConnection(
	left: RemoteEnvironmentProfile,
	right: RemoteEnvironmentProfile,
): boolean {
	return (
		left.host === right.host &&
		left.user === right.user &&
		left.port === right.port &&
		left.identityFile === right.identityFile
	);
}

function assertProfileUpdateAllowed(
	existing: RemoteEnvironmentProfile,
	next: Pick<
		RemoteEnvironmentProfile,
		"host" | "user" | "port" | "identityFile"
	>,
	connected: boolean,
): void {
	if (
		existing.host !== next.host ||
		existing.user !== next.user ||
		existing.port !== next.port
	) {
		throw new Error(
			"SSH host, user, and port cannot be changed for an existing remote environment. Create a new remote environment instead.",
		);
	}
	if (connected && existing.identityFile !== next.identityFile) {
		throw new Error(
			"Disconnect the remote environment before changing its SSH identity file.",
		);
	}
}

function validateCommandInput(input: RemoteCommandInput): void {
	if (!input.command || /[\0\r\n]/.test(input.command)) {
		throw new Error(
			"Remote command must be non-empty and cannot contain newlines or NUL bytes",
		);
	}
	if (
		!Array.isArray(input.args) ||
		input.args.some(
			(argument) => typeof argument !== "string" || argument.includes("\0"),
		)
	) {
		throw new Error(
			"Remote command arguments must be strings without NUL bytes",
		);
	}
	if (input.cwd && /[\0\r\n]/.test(input.cwd)) {
		throw new Error(
			"Remote working directory cannot contain newlines or NUL bytes",
		);
	}
}

function buildRemoteCommand(
	command: string,
	args: string[],
	cwd?: string,
): string {
	const invocation = [command, ...args].map(shellQuote).join(" ");
	return cwd
		? `cd ${shellQuote(cwd)} && exec ${invocation}`
		: `exec ${invocation}`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function resolveRemotePath(path: string, home: string): string {
	const resolved =
		path === "~"
			? home
			: path.startsWith("~/")
				? joinRemote(home, path.slice(2))
				: path;
	if (!resolved.startsWith("/") || /[\0\r\n]/.test(resolved)) {
		throw new Error(`Remote path must be absolute or start with ~/: ${path}`);
	}
	return resolved;
}

function joinRemote(base: string, suffix: string): string {
	return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function normalizePlatform(
	value: string | undefined,
): "linux" | "darwin" | undefined {
	if (value?.toLowerCase() === "linux") {
		return "linux";
	}
	if (value?.toLowerCase() === "darwin") {
		return "darwin";
	}
	return undefined;
}

function normalizeArch(value: string | undefined): "x64" | "arm64" | undefined {
	switch (value?.toLowerCase()) {
		case "x86_64":
		case "amd64":
			return "x64";
		case "aarch64":
		case "arm64":
			return "arm64";
		default:
			return undefined;
	}
}

function parseRemoteHubResult(stdout: string): {
	port: number;
	pathname: string;
	authToken: string;
} {
	const lines = stdout.trim().split("\n").filter(Boolean);
	let parsed: unknown;
	try {
		parsed = JSON.parse(lines.at(-1) ?? "");
	} catch (error) {
		throw new Error(
			"Remote remote helper returned invalid hub discovery JSON",
			{ cause: error },
		);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Remote remote helper returned invalid hub discovery data");
	}
	const record = parsed as Record<string, unknown>;
	if (typeof record.authToken !== "string" || !record.authToken) {
		throw new Error("Remote remote helper did not return a hub auth token");
	}

	let port = typeof record.port === "number" ? record.port : undefined;
	let pathname = typeof record.pathname === "string" ? record.pathname : "/hub";
	if (typeof record.url === "string") {
		let url: URL;
		try {
			url = new URL(record.url);
		} catch (error) {
			throw new Error("Remote remote helper returned an invalid hub URL", {
				cause: error,
			});
		}
		if (
			!isLoopbackHost(url.hostname) ||
			!["ws:", "wss:", "http:", "https:"].includes(url.protocol)
		) {
			throw new Error("Remote remote helper hub URL must use a loopback host");
		}
		port = Number(
			url.port ||
				(url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80),
		);
		pathname = url.pathname || "/hub";
	}
	if (!Number.isInteger(port) || (port ?? 0) < 1 || (port ?? 0) > 65_535) {
		throw new Error("Remote remote helper returned an invalid hub port");
	}
	if (!pathname.startsWith("/") || /[\0\r\n]/.test(pathname)) {
		throw new Error("Remote remote helper returned an invalid hub path");
	}
	return { port: port as number, pathname, authToken: record.authToken };
}

function isLoopbackHost(host: string): boolean {
	return (
		host === "127.0.0.1" ||
		host === "localhost" ||
		host === "::1" ||
		host === "[::1]"
	);
}

function processFailure(action: string, result: RemoteCommandResult): Error {
	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	const details = [
		...(stderr ? [`stderr:\n${stderr}`] : []),
		...(stdout ? [`stdout:\n${stdout}`] : []),
	];
	return new Error(
		`Failed to ${action} (exit ${result.exitCode})${
			details.length > 0 ? `:\n${details.join("\n")}` : ""
		}`,
	);
}

function expandLocalHome(path: string): string {
	return path === "~"
		? homedir()
		: path.startsWith("~/")
			? join(homedir(), path.slice(2))
			: path;
}

function isProfilesFile(value: unknown): value is ProfilesFile {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.version === PROFILE_FILE_VERSION &&
		Array.isArray(record.profiles) &&
		record.profiles.every(isProfile)
	);
}

function isProfile(value: unknown): value is RemoteEnvironmentProfile {
	if (!value || typeof value !== "object") {
		return false;
	}
	const profile = value as Record<string, unknown>;
	return (
		typeof profile.id === "string" &&
		typeof profile.name === "string" &&
		typeof profile.host === "string" &&
		(profile.user === undefined || typeof profile.user === "string") &&
		(profile.port === undefined || typeof profile.port === "number") &&
		(profile.identityFile === undefined ||
			typeof profile.identityFile === "string") &&
		typeof profile.createdAt === "string" &&
		typeof profile.updatedAt === "string"
	);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
