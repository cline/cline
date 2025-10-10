import { useCallback, useState } from "react"

export type MatrixParseStep = "upload" | "confirm_dbc" | "validate_dbc" | "convert_to_code" | "validate_code" | "completed"

export interface MatrixParseState {
	step: MatrixParseStep
	uploadedFile: File | null
	dbcFileContent: string | null
	generatedCode: string | null
	language: "c" | "java" | null
	isProcessing: boolean
	error: string | null
	validationResults: {
		dbcValid: boolean | null
		codeValid: boolean | null
		dbcErrors: string[]
		codeErrors: string[]
	}
}

export interface MatrixParseActions {
	setStep: (step: MatrixParseStep) => void
	setUploadedFile: (file: File | null) => void
	setDbcFileContent: (content: string | null) => void
	setGeneratedCode: (code: string | null) => void
	setLanguage: (language: "c" | "java" | null) => void
	setIsProcessing: (processing: boolean) => void
	setError: (error: string | null) => void
	setValidationResults: (results: MatrixParseState["validationResults"]) => void
	resetState: () => void
}

export function useMatrixParseState(): MatrixParseState & MatrixParseActions {
	const [step, setStep] = useState<MatrixParseStep>("upload")
	const [uploadedFile, setUploadedFile] = useState<File | null>(null)
	const [dbcFileContent, setDbcFileContent] = useState<string | null>(null)
	const [generatedCode, setGeneratedCode] = useState<string | null>(null)
	const [language, setLanguage] = useState<"c" | "java" | null>(null)
	const [isProcessing, setIsProcessing] = useState<boolean>(false)
	const [error, setError] = useState<string | null>(null)
	const [validationResults, setValidationResults] = useState<MatrixParseState["validationResults"]>({
		dbcValid: null,
		codeValid: null,
		dbcErrors: [],
		codeErrors: [],
	})

	const resetState = useCallback(() => {
		setStep("upload")
		setUploadedFile(null)
		setDbcFileContent(null)
		setGeneratedCode(null)
		setLanguage(null)
		setIsProcessing(false)
		setError(null)
		setValidationResults({
			dbcValid: null,
			codeValid: null,
			dbcErrors: [],
			codeErrors: [],
		})
	}, [])

	return {
		// State
		step,
		uploadedFile,
		dbcFileContent,
		generatedCode,
		language,
		isProcessing,
		error,
		validationResults,

		// Actions
		setStep,
		setUploadedFile,
		setDbcFileContent,
		setGeneratedCode,
		setLanguage,
		setIsProcessing,
		setError,
		setValidationResults,
		resetState,
	}
}
