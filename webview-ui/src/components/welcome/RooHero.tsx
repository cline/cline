import { useState } from "react"

const RooHero = () => {
	const [imagesBaseUri] = useState(() => {
		const w = window as any
		return w.IMAGES_BASE_URI || ""
	})

	return (
		<div
			style={{
				backgroundColor: "var(--vscode-foreground)",
				WebkitMaskImage: `url('${imagesBaseUri}/roo-logo.svg')`,
				WebkitMaskRepeat: "no-repeat",
				WebkitMaskSize: "contain",
				maskImage: `url('${imagesBaseUri}/roo-logo.svg')`,
				maskRepeat: "no-repeat",
				maskSize: "contain",
			}}>
			<img src={imagesBaseUri + "/roo-logo.svg"} alt="Roo logo" className="h-8 opacity-0" />
		</div>
	)
}

export default RooHero
