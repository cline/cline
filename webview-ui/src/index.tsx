import React from "react"
import ReactDOM from "react-dom/client"
import "./index.css"
import App from "./App"
import reportWebVitals from "./reportWebVitals"
import "../../node_modules/@vscode/codicons/dist/codicon.css"
import { PostHogProvider } from "posthog-js/react"

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement)
root.render(
	<React.StrictMode>
		<PostHogProvider
			apiKey="phc_5WnLHpYyC30Bsb7VSJ6DzcPXZ34JSF08DJLyM7svZ15"
			options={{ api_host: "https://us.i.posthog.com", capture_pageview: false }}>
			<App />
		</PostHogProvider>
	</React.StrictMode>,
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
