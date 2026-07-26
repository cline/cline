import type { ImgHTMLAttributes } from "react"
import type { Environment } from "../../../src/shared/config-types"
import bedrockCoderMark from "./bedrock-coder-mark.png"

type BedrockCoderLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
	environment?: Environment
}

const BedrockCoderLogoVariable = ({ environment: _environment, alt = "Bedrock Coder", ...props }: BedrockCoderLogoProps) => (
	<img alt={alt} src={bedrockCoderMark} {...props} />
)

export default BedrockCoderLogoVariable
