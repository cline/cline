export const LEARNING_PACK_SCHEMA_VERSION = 1 as const
export const LEARNING_PACK_API_VERSION = 1 as const
export const LEARNING_PACK_RUNTIME_CONTRACT = "html-preview-v1" as const

export type LearningPackEdition = "student" | "instructor"
export type LocalPythonCapability = "none" | "terminal-equivalent"

export interface LearningPackManifest {
	schemaVersion: 1
	packId: string
	version: string
	edition: LearningPackEdition
	title: string
	license: string
	publisher: {
		name: string
		keyId: string
	}
	ownership: {
		courseId: string
		moduleIds: string[]
	}
	entryModuleId: string
	compatibility: {
		aiHydro: string
		packApi: 1
		runtimeContract: "html-preview-v1"
	}
	capabilities: {
		localPython: LocalPythonCapability
		webExternalOrigins: []
	}
	environmentPath: "environments/environment.json"
	provenancePath: "provenance/provenance.json"
}

export interface LearningPackCourseModule {
	id: string
	path: string
	title: string
	prerequisites?: string[]
	[key: string]: unknown
}

export interface LearningPackCourse {
	courseId: string
	title: string
	modules: LearningPackCourseModule[]
	[key: string]: unknown
}

export interface LearningPackChecksumEntry {
	path: string
	sha256: string
	size: number
}

export interface LearningPackChecksums {
	algorithm: "sha256"
	files: LearningPackChecksumEntry[]
}

export interface LearningPackSignature {
	algorithm: "Ed25519"
	publicKeySpki: string
	signature: string
}

export type LearningPackValidationStatus = "valid" | "invalid" | "incompatible"

export interface LearningPackDiagnostic {
	code: string
	message: string
	path?: string
}

export interface VerifiedLearningPackContract {
	manifest: Readonly<LearningPackManifest>
	course: Readonly<LearningPackCourse>
	checksums: Readonly<LearningPackChecksums>
	signerFingerprint: string
}

export interface LearningPackValidationResult {
	status: LearningPackValidationStatus
	diagnostics: LearningPackDiagnostic[]
	verified?: VerifiedLearningPackContract
}

export interface LearningPackRuntimeCompatibility {
	aiHydroVersion: string
}
