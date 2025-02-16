import { PaperPlaneIcon, StopIcon } from "@radix-ui/react-icons"

import { Button, AutosizeTextarea } from "@/components/ui"

import { ChatInputProvider } from "./ChatInputProvider"
import { useChatUI } from "./useChatUI"
import { useChatInput } from "./useChatInput"

export function ChatInput() {
	const { input, setInput, append, isLoading } = useChatUI()
	const isDisabled = isLoading || !input.trim()

	const submit = async () => {
		if (input.trim() === "") {
			return
		}

		setInput("")
		await append({ role: "user", content: input })
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		await submit()
	}

	const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (isDisabled) {
			return
		}

		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			await submit()
		}
	}

	return (
		<ChatInputProvider value={{ isDisabled, handleKeyDown, handleSubmit }}>
			<div className="border-t border-vscode-editor-background p-3">
				<ChatInputForm />
			</div>
		</ChatInputProvider>
	)
}

function ChatInputForm() {
	const { handleSubmit } = useChatInput()

	return (
		<form onSubmit={handleSubmit} className="relative">
			<ChatInputField />
			<ChatInputSubmit />
		</form>
	)
}

interface ChatInputFieldProps {
	placeholder?: string
}

function ChatInputField({ placeholder = "Chat" }: ChatInputFieldProps) {
	const { input, setInput } = useChatUI()
	const { handleKeyDown } = useChatInput()

	return (
		<AutosizeTextarea
			name="input"
			placeholder={placeholder}
			minHeight={75}
			maxHeight={200}
			value={input}
			onChange={({ target: { value } }) => setInput(value)}
			onKeyDown={handleKeyDown}
			className="resize-none px-3 pt-3 pb-[50px]"
		/>
	)
}

function ChatInputSubmit() {
	const { isLoading, stop } = useChatUI()
	const { isDisabled } = useChatInput()
	const isStoppable = isLoading && !!stop

	return (
		<div className="absolute bottom-[1px] left-[1px] right-[1px] h-[40px] bg-input border-t border-vscode-editor-background rounded-b-md p-1">
			<div className="flex flex-row-reverse items-center gap-2">
				{isStoppable ? (
					<Button type="button" variant="ghost" size="sm" onClick={stop}>
						<StopIcon className="text-destructive" />
					</Button>
				) : (
					<Button type="submit" variant="ghost" size="icon" disabled={isDisabled}>
						<PaperPlaneIcon />
					</Button>
				)}
			</div>
		</div>
	)
}
