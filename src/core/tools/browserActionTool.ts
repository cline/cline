import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"
import { BrowserSettings } from "@shared/BrowserSettings"

export const browserActionToolName = "BrowserAction"

const descriptionForAgent = (
	browserSettings: BrowserSettings,
) => `Request to interact with a Puppeteer-controlled browser. Every action, except \`close\`, will be responded to with a screenshot of the browser's current state, along with any new console logs. You may only perform one browser action per message, and wait for the user's response including a screenshot and logs to determine the next action.
- The sequence of actions **must always start with** launching the browser at a URL, and **must always end with** closing the browser. If you need to visit a new URL that is not possible to navigate to from the current webpage, you must first close the browser, then launch again at the new URL.
- While the browser is active, only the \`${browserActionToolName}\` tool can be used. No other tools should be called during this time. You may proceed to use other tools only after closing the browser. For example if you run into an error and need to fix a file, you must close the browser, then use other tools to make the necessary changes, then re-launch the browser to verify the result.
- The browser window has a resolution of **${browserSettings.viewport.width}x${browserSettings.viewport.height}** pixels. When performing any click actions, ensure the coordinates are within this resolution range.
- Before clicking on any elements such as icons, links, or buttons, you must consult the provided screenshot of the page to determine the coordinates of the element. The click should be targeted at the **center of the element**, not on its edges.`

export const browserActionToolDefinition = (browserSettings: BrowserSettings): ToolDefinition => ({
	name: browserActionToolName,
	descriptionForAgent: descriptionForAgent(browserSettings),
	inputSchema: {
		type: "object",
		properties: {
			action: {
				type: "string",
				description: `The action to perform. The available actions are:
* launch: Launch a new Puppeteer-controlled browser instance at the specified URL. This **must always be the first action**.
    - Use with the \`url\` parameter to provide the URL.
    - Ensure the URL is valid and includes the appropriate protocol (e.g. http://localhost:3000/page, file:///path/to/file.html, etc.)
* click: Click at a specific x,y coordinate.
    - Use with the \`coordinate\` parameter to specify the location.
    - Always click in the center of an element (icon, button, link, etc.) based on coordinates derived from a screenshot.
* type: Type a string of text on the keyboard. You might use this after clicking on a text field to input text.
    - Use with the \`text\` parameter to provide the string to type.
* scroll_down: Scroll down the page by one page height.
* scroll_up: Scroll up the page by one page height.
* close: Close the Puppeteer-controlled browser instance. This **must always be the final browser action**.
    - Example: \`<action>close</action>\``,
			},
			url: {
				type: "string",
				description: `Use this for providing the URL for the \`launch\` action.
Example: <url>https://example.com</url>`,
			},
			coordinate: {
				type: "string",
				description: `The X and Y coordinates for the \`click\` action. Coordinates should be within the **${browserSettings.viewport.width}x${browserSettings.viewport.height}** resolution.
Example: <coordinate>450,300</coordinate>`,
			},
			text: {
				type: "string",
				description: `Use this for providing the text for the \`type\` action.
Example: <text>Hello, world!</text>`,
			},
		},
		required: ["action"],
	},
})
