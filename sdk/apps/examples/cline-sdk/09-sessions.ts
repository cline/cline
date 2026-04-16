/**
 * 09-sessions.ts
 *
 * Learn how to manage agent sessions.
 *
 * This example shows how to:
 * - List existing sessions
 * - Resume/continue sessions
 * - Stop and clean up sessions
 * - Read session artifacts (transcripts, logs)
 * - Handle session persistence
 *
 * Session artifacts stored in ~/.cline/data/sessions/:
 * - <sessionId>.json: Session manifest
 * - <sessionId>.log: Full transcript log
 * - <sessionId>.messages.json: Message history
 *
 * Hook audit log stored in ~/.cline/data/logs/hooks.jsonl
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 09-sessions.ts
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ClineCore } from "@clinebot/core";

async function demoCreateSession() {
	console.log("\n=== Create New Session ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "Hello! Tell me a programming joke.",
		interactive: true, // Enable interactive mode for continuation
	});

	console.log("Session created:");
	console.log(`  Session ID: ${result.sessionId}`);
	console.log(`  Status: ${result.manifest.status}`);
	console.log(`  Started: ${result.manifest.started_at}`);
	console.log(`\nResponse:\n${result.result?.text}`);

	// Keep session manager alive for next demo
	return { sessionManager, sessionId: result.sessionId };
}

async function demoContinueSession(
	sessionManager: ClineCore,
	sessionId: string,
) {
	console.log("\n=== Continue Existing Session ===\n");

	// Send a follow-up message to the same session
	const result = await sessionManager.send({
		sessionId,
		prompt: "Great! Now tell me a fact about TypeScript.",
	});

	console.log(`Continuing session ${sessionId}\n`);
	console.log(`Response:\n${result?.text}`);

	return sessionManager;
}

async function demoListSessions(sessionManager: ClineCore) {
	console.log("\n=== List All Sessions ===\n");

	// List recent sessions
	const sessions = await sessionManager.list(10);

	console.log(`Found ${sessions.length} session(s):\n`);

	for (const session of sessions) {
		console.log(`Session ${session.sessionId}:`);
		console.log(`  Status: ${session.status}`);
		console.log(`  Provider: ${session.provider}`);
		console.log(`  Model: ${session.model}`);
		console.log(`  Started: ${session.startedAt}`);
		console.log(`  CWD: ${session.cwd}`);
		console.log();
	}

	return sessions;
}

async function demoReadSessionArtifacts(sessionId: string) {
	console.log("\n=== Read Session Artifacts ===\n");

	try {
		const sessionDir = process.env.CLINE_SESSION_DATA_DIR
			? process.env.CLINE_SESSION_DATA_DIR
			: join(homedir(), ".cline", "data", "sessions");

		// Read session manifest
		const manifestPath = join(sessionDir, `${sessionId}.json`);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

		console.log("Session Manifest:");
		console.log(`  Session ID: ${manifest.session_id}`);
		console.log(`  Status: ${manifest.status}`);
		console.log(`  Provider: ${manifest.provider}`);
		console.log(`  Model: ${manifest.model}`);
		console.log(`  Interactive: ${manifest.interactive}`);
		console.log(`  Prompt: ${manifest.prompt}`);

		// Read messages
		const messagesPath = join(sessionDir, `${sessionId}.messages.json`);
		try {
			const messages = JSON.parse(readFileSync(messagesPath, "utf-8"));
			console.log(`\nMessage Count: ${messages.length}`);

			// Show first few messages
			console.log("\nFirst message:");
			if (messages[0]) {
				console.log(`  Role: ${messages[0].role}`);
				console.log(
					`  Content: ${JSON.stringify(messages[0].content).slice(0, 100)}...`,
				);
			}
		} catch {
			console.log("\nMessages: Not yet available");
		}

		// Read transcript (first 500 chars)
		const transcriptPath = join(sessionDir, `${sessionId}.log`);
		try {
			const transcript = readFileSync(transcriptPath, "utf-8");
			console.log("\nTranscript preview (first 500 chars):");
			console.log(transcript.slice(0, 500));
			console.log("...");
		} catch {
			console.log("\nTranscript: Not yet available");
		}
	} catch (error) {
		console.error("Error reading artifacts:", error);
	}
}

async function demoStopSession(sessionManager: ClineCore, sessionId: string) {
	console.log("\n=== Stop Session ===\n");

	await sessionManager.stop(sessionId);
	console.log(`Session ${sessionId} stopped successfully`);

	// Verify it's stopped by listing again
	const sessions = await sessionManager.list(10);
	const stoppedSession = sessions.find((s) => s.sessionId === sessionId);

	if (stoppedSession) {
		console.log(`Status: ${stoppedSession.status}`);
	}
}

async function demoMultipleSessions() {
	console.log("\n=== Multiple Concurrent Sessions ===\n");

	const sessionManager = await ClineCore.create({});

	// Create multiple sessions
	console.log("Creating 3 parallel sessions...\n");

	const session1 = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "Count from 1 to 5",
		interactive: true,
	});

	const session2 = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "List 3 programming languages",
		interactive: true,
	});

	const session3 = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "What is 2 + 2?",
		interactive: true,
	});

	console.log(
		`Session 1 (${session1.sessionId}): ${session1.result?.text?.slice(0, 50)}...`,
	);
	console.log(
		`Session 2 (${session2.sessionId}): ${session2.result?.text?.slice(0, 50)}...`,
	);
	console.log(
		`Session 3 (${session3.sessionId}): ${session3.result?.text?.slice(0, 50)}...`,
	);

	// Clean up
	await sessionManager.stop(session1.sessionId);
	await sessionManager.stop(session2.sessionId);
	await sessionManager.stop(session3.sessionId);

	await sessionManager.dispose();
}

async function demoSessionResume() {
	console.log("\n=== Resume Session After Restart ===\n");

	// Create a session and close the manager
	const manager1 = await ClineCore.create({});

	const result = await manager1.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt:
				"You are a helpful assistant. Remember context from previous messages.",
		},
		prompt: "My favorite color is blue. Remember this.",
		interactive: true,
	});

	const sessionId = result.sessionId;
	console.log(`Created session: ${sessionId}`);
	console.log(`Response: ${result.result?.text}\n`);

	// Dispose manager (simulate app restart)
	await manager1.dispose();
	console.log("Session manager disposed (simulating restart)\n");

	// Create new manager and resume the session
	const manager2 = await ClineCore.create({});

	console.log("Resuming session with new manager...");

	const resumeResult = await manager2.send({
		sessionId,
		prompt: "What's my favorite color?",
	});

	console.log(`Response: ${resumeResult?.text}`);

	await manager2.stop(sessionId);
	await manager2.dispose();
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	// Run demos in sequence
	const { sessionManager, sessionId } = await demoCreateSession();
	await demoContinueSession(sessionManager, sessionId);
	await demoListSessions(sessionManager);
	await demoReadSessionArtifacts(sessionId);
	await demoStopSession(sessionManager, sessionId);
	await sessionManager.dispose();

	await demoMultipleSessions();
	await demoSessionResume();

	console.log("\n✅ All session management demos completed!");
	console.log("\n💡 Tips for session management:");
	console.log("   • Sessions persist in ~/.cline/data/sessions/");
	console.log("   • Use interactive: true to enable continuation");
	console.log("   • Always dispose() session manager on shutdown");
	console.log("   • Session artifacts contain full history for debugging");
	console.log("   • You can resume sessions across app restarts");
}

main().catch(console.error);
