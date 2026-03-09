import type { ComponentProps } from "react"
import React, { useState } from "react"
import { Button } from "@/components/ui/button"

type UnsafeImageProps = ComponentProps<"img">

const UnsafeImage: React.FC<UnsafeImageProps> = ({ src = "", alt = "", ...imgProps }) => {
	const [isApproved, setIsApproved] = useState(false)

	if (!src) {
		return null
	}

	// If it's base-64 encoded image (starts with `data:`), we can render it regardless of consent
	if (!isApproved && !src.startsWith("data:")) {
		return (
			<span className="my-2 block flex flex-col rounded-md border border-input-border bg-code p-3">
				<p className="m-0 text-sm font-medium">External image blocked pending consent</p>
				<p className="mt-2 mb-0 break-all text-xs text-muted-foreground">
					Source: <code>{src}</code> <br />
					Alt: <code>{alt}</code>
				</p>
				<Button className="mt-3" onClick={() => setIsApproved(true)} type="button" variant="outline">
					Load image
				</Button>
			</span>
		)
	}

	return <img alt={alt} src={src} {...imgProps} />
}

export default UnsafeImage
