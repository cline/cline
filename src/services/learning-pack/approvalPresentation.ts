import type { LearningPackArchiveInspection } from "./inspectLearningPackArchive"
import type { LearningPackApproval } from "./learningPackLifecycle"

export interface LearningPackApprovalPrompt {
	readonly message: string
	readonly detail: string
	readonly items: readonly string[]
}

export interface LearningPackApprovalPresentation {
	readonly instructorWarning?: LearningPackApprovalPrompt
	readonly installPrompt: LearningPackApprovalPrompt
	readonly trustedPublisher: boolean
}

export type LearningPackWarningPrompt = (prompt: LearningPackApprovalPrompt) => PromiseLike<string | undefined>

function inspectionDetails(inspection: LearningPackArchiveInspection): string {
	const manifest = inspection.contract.manifest
	return [
		`Edition: ${manifest.edition}`,
		`Signer: ${inspection.contract.signerFingerprint}`,
		`AI-Hydro compatibility: ${manifest.compatibility.aiHydro}`,
		`Local Python: ${manifest.capabilities.localPython} (terminal-equivalent, not sandboxed)`,
		`Environment metadata: ${manifest.environmentPath}`,
		`External web origins: none`,
	].join("\n")
}

export function createLearningPackApprovalPresentation(
	inspection: LearningPackArchiveInspection,
	trustedPublisher: boolean,
): LearningPackApprovalPresentation {
	const manifest = inspection.contract.manifest
	const detail = inspectionDetails(inspection)
	return Object.freeze({
		...(manifest.edition === "instructor"
			? {
					instructorWarning: Object.freeze({
						message:
							"Install instructor Learning Pack? Instructor materials may include inspectable solutions and are not role-protected.",
						detail,
						items: Object.freeze(["Continue"]),
					}),
				}
			: {}),
		installPrompt: Object.freeze(
			trustedPublisher
				? {
						message: `Install ${manifest.title} ${manifest.version}?`,
						detail,
						items: Object.freeze(["Install"]),
					}
				: {
						message: `The publisher key for ${manifest.title} is signed but not trusted.`,
						detail,
						items: Object.freeze(["Install Once", "Trust Publisher and Install"]),
					},
		),
		trustedPublisher,
	})
}

export async function requestLearningPackApproval(
	presentation: LearningPackApprovalPresentation,
	prompt: LearningPackWarningPrompt,
): Promise<LearningPackApproval> {
	if (presentation.instructorWarning) {
		if ((await prompt(presentation.instructorWarning)) !== "Continue") return "cancel"
	}
	const decision = await prompt(presentation.installPrompt)
	if (presentation.trustedPublisher) return decision === "Install" ? "install-once" : "cancel"
	if (decision === "Install Once") return "install-once"
	if (decision === "Trust Publisher and Install") return "trust-publisher"
	return "cancel"
}
