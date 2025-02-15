export interface Message {
	role: "system" | "user" | "assistant" | "data"
	content: string
	annotations?: MessageAnnotation[]
}

export type ChatHandler = {
	isLoading: boolean
	setIsLoading: (isLoading: boolean, message?: string) => void

	loadingMessage?: string
	setLoadingMessage?: (message: string) => void

	input: string
	setInput: (input: string) => void

	messages: Message[]

	reload?: (options?: { data?: any }) => void
	stop?: () => void
	append: (message: Message, options?: { data?: any }) => Promise<string | null | undefined>
	reset?: () => void
}

export enum MessageAnnotationType {
	BADGE = "badge",
}

export type BadgeData = {
	label: string
	variant?: "default" | "secondary" | "destructive" | "outline"
}

export type AnnotationData = BadgeData

export type MessageAnnotation = {
	type: MessageAnnotationType
	data: AnnotationData
}
