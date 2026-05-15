import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmdirSync,
	rmSync,
	unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	parseSubSessionId,
	parseTeamTaskSubSessionId,
} from "../session/models/session-graph";

export function nowIso(): string {
	return new Date().toISOString();
}

export function unlinkIfExists(path: string | null | undefined): void {
	if (!path || !existsSync(path)) {
		return;
	}
	try {
		unlinkSync(path);
	} catch {
		// Best effort cleanup.
	}
}

export interface SessionArtifactPaths {
	messagesPath: string;
}

function childArtifactFileStem(sessionId: string): {
	rootSessionId: string;
	fileStem: string;
} {
	const teamTask = parseTeamTaskSubSessionId(sessionId);
	if (teamTask) {
		return {
			rootSessionId: teamTask.rootSessionId,
			fileStem: `${teamTask.agentId}__${teamTask.teamTaskId}`,
		};
	}

	const subagent = parseSubSessionId(sessionId);
	if (subagent) {
		return {
			rootSessionId: subagent.rootSessionId,
			fileStem: subagent.agentId,
		};
	}

	return {
		rootSessionId: sessionId,
		fileStem: sessionId,
	};
}

export class SessionArtifacts {
	constructor(private readonly ensureSessionsDir: () => string) {}

	public sessionArtifactsDir(sessionId: string): string {
		return join(this.ensureSessionsDir(), sessionId);
	}

	public ensureSessionArtifactsDir(sessionId: string): string {
		const dir = this.sessionArtifactsDir(sessionId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	public sessionMessagesPath(sessionId: string): string {
		return join(
			this.sessionArtifactsDir(sessionId),
			`${sessionId}.messages.json`,
		);
	}

	public sessionManifestPath(sessionId: string, ensureDir = false): string {
		const base = ensureDir
			? this.ensureSessionArtifactsDir(sessionId)
			: this.sessionArtifactsDir(sessionId);
		return join(base, `${sessionId}.json`);
	}

	public removeSessionDirIfEmpty(sessionId: string): void {
		let dir = this.sessionArtifactsDir(sessionId);
		const sessionsDir = this.ensureSessionsDir();
		while (dir.startsWith(sessionsDir) && dir !== sessionsDir) {
			if (!existsSync(dir)) {
				dir = dirname(dir);
				continue;
			}
			try {
				if (readdirSync(dir).length > 0) {
					break;
				}
				rmdirSync(dir);
			} catch {
				// Best-effort cleanup.
				break;
			}
			dir = dirname(dir);
		}
	}

	public removeSessionDir(sessionId: string): void {
		this.removeDir(this.sessionArtifactsDir(sessionId));
	}

	public removeDir(dir: string): void {
		if (!existsSync(dir)) {
			return;
		}
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup.
		}
	}

	public subagentArtifactPaths(
		sessionId: string,
		subAgentId: string,
		activeTeamTaskSessionId?: string,
	): SessionArtifactPaths {
		void subAgentId;
		void activeTeamTaskSessionId;
		const { rootSessionId, fileStem } = childArtifactFileStem(sessionId);
		const dir = this.sessionArtifactsDir(rootSessionId);
		return {
			messagesPath: join(dir, `${fileStem}.messages.json`),
		};
	}
}
