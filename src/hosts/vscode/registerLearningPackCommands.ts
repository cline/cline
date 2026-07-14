import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { prerelease } from "semver"
import * as vscode from "vscode"
import type { Controller } from "@/core/controller"
import { previewHtml } from "@/core/controller/htmlPreview/previewHtml"
import { VscodeHtmlPreviewProvider } from "@/hosts/vscode/VscodeHtmlPreviewProvider"
import { loadProgress as loadCourseProgress } from "@/services/htmlPreview/courseProgressStore"
import {
	createLearningPackApprovalPresentation,
	requestLearningPackApproval,
} from "@/services/learning-pack/approvalPresentation"
import {
	inspectLearningPackArchiveFile,
	type LearningPackArchiveInspection,
} from "@/services/learning-pack/inspectLearningPackArchive"
import {
	installLearningPack,
	type LearningPackApproval,
	type LegacyOwnership,
	loadLearningPackRegistry,
	removeLearningPack,
	rollbackLearningPack,
} from "@/services/learning-pack/learningPackLifecycle"
import {
	defaultLearningPackRoot,
	learningPackProgressKey,
	resolveActiveLearningPackEntry,
	resolveActiveLearningPackLaunch,
} from "@/services/learning-pack/runtimeIntegration"
import { loadTrustedPublishers, removeTrustedPublisher } from "@/services/learning-pack/trustStore"
import { isInTestMode } from "@/services/test/TestMode"
import { PreviewHtmlRequest } from "@/shared/proto/cline/html_preview"

export interface LearningPackCommandIds {
	readonly install: string
	readonly rollback: string
	readonly remove: string
	readonly manageTrustedPublishers: string
}

interface TestInstallOptions {
	readonly archivePath?: string
	readonly approval?: LearningPackApproval
	readonly prereleaseOptIn?: boolean
}

interface TestTransitionOptions {
	readonly packId?: string
	readonly confirmed?: boolean
}

function archivePathFromCommandArgument(value: unknown): string | undefined {
	if (value instanceof vscode.Uri && value.scheme === "file" && value.fsPath.toLowerCase().endsWith(".aihydropack")) {
		return value.fsPath
	}
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
	const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined
	return uri?.scheme === "file" && uri.fsPath.toLowerCase().endsWith(".aihydropack") ? uri.fsPath : undefined
}

async function readLegacyOwnership(): Promise<LegacyOwnership> {
	const courseIds = new Set<string>()
	const moduleIds = new Set<string>()
	try {
		const registry = JSON.parse(
			await fs.readFile(path.join(os.homedir(), ".aihydro", "modules", "installed.json"), "utf8"),
		) as Record<string, { id?: unknown; courseId?: unknown }>
		for (const [key, entry] of Object.entries(registry)) {
			moduleIds.add(typeof entry.id === "string" ? entry.id : key)
			if (typeof entry.courseId === "string") courseIds.add(entry.courseId)
		}
	} catch {
		// No legacy registry is a normal clean install.
	}
	try {
		for (const entry of await fs.readdir(path.join(os.homedir(), ".aihydro", "courses"), { withFileTypes: true })) {
			if (entry.isDirectory()) courseIds.add(entry.name)
		}
	} catch {
		// No legacy courses directory is a normal clean install.
	}
	return { courseIds, moduleIds }
}

async function chooseApproval(root: string, inspection: LearningPackArchiveInspection): Promise<LearningPackApproval> {
	const trusted = (await loadTrustedPublishers(root)).fingerprints.includes(inspection.contract.signerFingerprint)
	return requestLearningPackApproval(createLearningPackApprovalPresentation(inspection, trusted), (prompt) =>
		vscode.window.showWarningMessage(prompt.message, { modal: true, detail: prompt.detail }, ...prompt.items),
	)
}

async function openActiveModule(controller: Controller, root: string, packId: string): Promise<void> {
	const entry = await resolveActiveLearningPackEntry(root, packId)
	const progress = await loadCourseProgress(learningPackProgressKey(entry.scope))
	const module = await resolveActiveLearningPackLaunch(root, packId, progress.currentModuleId)
	await previewHtml(controller, PreviewHtmlRequest.create({ htmlContent: "", title: module.title, filePath: module.filePath }))
	await VscodeHtmlPreviewProvider.createOrShow()
}

function closePackPreviews(controller: Controller, packId: string): void {
	for (const artifact of controller.getArtifactPreviewService().list()) {
		if (artifact.metadata.learningPackId === packId) controller.removeHtmlPreview(artifact.id)
	}
}

async function chooseInstalledPack(root: string, placeHolder: string): Promise<string | undefined> {
	const registry = await loadLearningPackRegistry(root)
	const entries = Object.entries(registry.packs).map(([packId, record]) => ({
		label: packId,
		description: `${record.active.version} · ${record.active.edition}`,
		packId,
	}))
	if (entries.length === 0) {
		void vscode.window.showInformationMessage("No Learning Packs are installed.")
		return undefined
	}
	return (await vscode.window.showQuickPick(entries, { placeHolder }))?.packId
}

export function registerLearningPackCommands(
	context: vscode.ExtensionContext,
	controller: Controller,
	commands: LearningPackCommandIds,
): void {
	const root = defaultLearningPackRoot()
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.install, async (commandArgument?: vscode.Uri | TestInstallOptions) => {
			try {
				const injected = isInTestMode() && !(commandArgument instanceof vscode.Uri) ? commandArgument : undefined
				const archivePath =
					injected?.archivePath ??
					archivePathFromCommandArgument(commandArgument) ??
					(
						await vscode.window.showOpenDialog({
							canSelectFiles: true,
							canSelectFolders: false,
							canSelectMany: false,
							filters: { "AI-Hydro Learning Pack": ["aihydropack"] },
							title: "Install Local AI-Hydro Learning Pack",
						})
					)?.[0]?.fsPath
				if (!archivePath) return { status: "cancelled" }
				const inspected = await inspectLearningPackArchiveFile(archivePath, {
					aiHydroVersion: context.extension.packageJSON.version,
				})
				if (inspected.status !== "valid" || !inspected.inspection) {
					const detail = inspected.diagnostics
						.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
						.join("\n")
					void vscode.window.showErrorMessage(`Learning Pack rejected: ${detail}`)
					return { status: inspected.status, diagnostics: inspected.diagnostics }
				}
				const inspection = inspected.inspection
				const manifest = inspection.contract.manifest
				let prereleaseOptIn = injected?.prereleaseOptIn ?? false
				if (prerelease(manifest.version) !== null && !prereleaseOptIn) {
					prereleaseOptIn =
						(await vscode.window.showWarningMessage(
							`Install prerelease ${manifest.version}? Prerelease packs require separate confirmation.`,
							{ modal: true },
							"Install Prerelease",
						)) === "Install Prerelease"
					if (!prereleaseOptIn) return { status: "cancelled" }
				}
				const approval = injected?.approval ?? (await chooseApproval(root, inspection))
				const result = await installLearningPack(root, inspection, approval, {
					prereleaseOptIn,
					legacyOwnership: await readLegacyOwnership(),
				})
				if (result.status === "installed" || result.status === "noop") {
					if (result.status === "installed") closePackPreviews(controller, manifest.packId)
					await openActiveModule(controller, root, manifest.packId)
					void vscode.window.showInformationMessage(
						`${manifest.title} ${manifest.version} (${manifest.edition}) is ready.`,
					)
				} else if (result.status !== "cancelled") {
					void vscode.window.showWarningMessage(result.message ?? `Learning Pack ${result.status}.`)
				}
				return result
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				void vscode.window.showErrorMessage(`Learning Pack installation failed: ${message}`)
				return { status: "failed", message }
			}
		}),
		vscode.commands.registerCommand(commands.rollback, async (commandArgument?: TestTransitionOptions) => {
			const injected = isInTestMode() ? commandArgument : undefined
			const packId = injected?.packId ?? (await chooseInstalledPack(root, "Select a Learning Pack to roll back"))
			if (!packId) return { status: "cancelled" }
			const confirmed = injected
				? injected.confirmed
					? "Roll Back"
					: undefined
				: await vscode.window.showWarningMessage(
						`Roll back ${packId} to its verified predecessor?`,
						{ modal: true },
						"Roll Back",
					)
			if (confirmed !== "Roll Back") return { status: "cancelled" }
			const result = await rollbackLearningPack(root, packId)
			if (result.status === "rolled-back") {
				closePackPreviews(controller, packId)
				await openActiveModule(controller, root, packId)
			} else void vscode.window.showWarningMessage(result.message ?? `Learning Pack ${result.status}.`)
			return result
		}),
		vscode.commands.registerCommand(commands.remove, async (commandArgument?: TestTransitionOptions) => {
			const injected = isInTestMode() ? commandArgument : undefined
			const packId = injected?.packId ?? (await chooseInstalledPack(root, "Select a Learning Pack to remove"))
			if (!packId) return { status: "cancelled" }
			const confirmed = injected
				? injected.confirmed
					? "Remove Pack"
					: undefined
				: await vscode.window.showWarningMessage(
						`Remove ${packId}? Learning progress, controls, legacy content, and publisher trust will remain.`,
						{ modal: true },
						"Remove Pack",
					)
			if (confirmed !== "Remove Pack") return { status: "cancelled" }
			const result = await removeLearningPack(root, packId)
			if (result.status === "removed") {
				closePackPreviews(controller, packId)
				void vscode.window.showInformationMessage(`${packId} was removed.`)
			} else void vscode.window.showWarningMessage(result.message ?? `Learning Pack ${result.status}.`)
			return result
		}),
		vscode.commands.registerCommand(commands.manageTrustedPublishers, async () => {
			const trusted = await loadTrustedPublishers(root)
			if (trusted.fingerprints.length === 0) {
				void vscode.window.showInformationMessage("No Learning Pack publisher keys are trusted.")
				return
			}
			const fingerprint = await vscode.window.showQuickPick(trusted.fingerprints, {
				placeHolder: "Select a trusted publisher key to remove",
			})
			if (!fingerprint) return
			const confirmed = await vscode.window.showWarningMessage(
				`Stop trusting ${fingerprint}? Existing packs remain installed; future installs and upgrades require approval.`,
				{ modal: true },
				"Remove Trust",
			)
			if (confirmed === "Remove Trust") await removeTrustedPublisher(root, fingerprint)
		}),
	)
}
