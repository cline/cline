import { Button } from "@heroui/button"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { cn } from "@/utils/cn"

const CopyTaskButton: React.FC<{
	taskText?: string
	className?: string
}> = ({ taskText, className }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		if (!taskText) {
			return
		}

		navigator.clipboard.writeText(taskText).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [taskText])

	return (
		<Button
			aria-label="Copy Task"
			className={cn("bg-transparent hover:opacity-100", className)}
			isIconOnly={true}
			onPress={() => {
				handleCopy()
			}}
			radius="sm"
			size="sm"
			title="Copy Task">
			{copied ? <CheckIcon size="14" /> : <CopyIcon size="14" />}
		</Button>
	)
}

export default CopyTaskButton
