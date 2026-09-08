import { SVGProps } from "react"
import { CLINE_LOGO_VIEW_BOX, ClineLogoShape } from "./ClineLogoShape"

const ClineLogoWhite = (props: SVGProps<SVGSVGElement>) => (
	<svg fill="none" height="50" viewBox={CLINE_LOGO_VIEW_BOX} width="50" xmlns="http://www.w3.org/2000/svg" {...props}>
		<title>Cline</title>
		<ClineLogoShape color="white" />
	</svg>
)
export default ClineLogoWhite
