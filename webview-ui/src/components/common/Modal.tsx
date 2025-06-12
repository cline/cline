interface ModalProps {
	isOpen: boolean
	onClose: () => void
	children: React.ReactNode
	className?: string
}

export function Modal({ isOpen, onClose, children, className = "" }: ModalProps) {
	if (!isOpen) return null

	return (
		<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]" onClick={onClose}>
			<div
				className={`bg-vscode-editor-background rounded w-[90%] h-[90%] max-w-[1200px] flex flex-col shadow-[0_5px_15px_rgba(0,0,0,0.5)] border border-vscode-editorGroup-border relative ${className}`}
				onClick={(e) => e.stopPropagation()}>
				{children}
			</div>
		</div>
	)
}
