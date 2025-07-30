import type { IncomingMessage, Server, ServerResponse } from "node:http"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { clineEnvConfig } from "@/config"
import { openExternal } from "@/utils/env"
import { SharedUriHandler } from "@/services/uri/SharedUriHandler"

const SERVER_TIMEOUT = 10 * 60 * 1000 // 10 minutes

/**
 * Handles OAuth authentication flow by creating a local server to receive tokens.
 */
export class AuthHandler {
	private static instance: AuthHandler | null = null

	private port = 0
	private server: Server | null = null
	private serverCreationPromise: Promise<void> | null = null
	private timeoutId: NodeJS.Timeout | null = null
	private enabled: boolean = false

	private constructor() {}

	/**
	 * Gets the singleton instance of AuthHandler
	 * @returns The singleton AuthHandler instance
	 */
	public static getInstance(): AuthHandler {
		if (!AuthHandler.instance) {
			AuthHandler.instance = new AuthHandler()
		}
		return AuthHandler.instance
	}

	public setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}

	public async getCallbackUri(): Promise<string | undefined> {
		try {
			if (!this.enabled) {
				return undefined
			}

			if (!this.server) {
				// If server creation is already in progress, wait for it
				if (this.serverCreationPromise) {
					await this.serverCreationPromise
				} else {
					// Start server creation and track the promise
					this.serverCreationPromise = this.createServer()
					await this.serverCreationPromise
				}
			} else {
				this.updateTimeout()
			}

			return `http://127.0.0.1:${this.port}`
		} catch (error) {
			console.error("AuthHandler.getCallbackUri error:", error)
			return undefined
		}
	}

	private async createServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const server = http.createServer(this.handleRequest.bind(this))

				// Use callback to ensure server is ready before getting address
				server.listen(0, "127.0.0.1", () => {
					const address = server.address()
					if (!address) {
						console.error("AuthHandler: Failed to get server address")
						this.server = null
						this.port = 0
						this.serverCreationPromise = null
						reject(new Error("Failed to get server address"))
						return
					}

					// Get the assigned port and set up the server
					this.port = (address as AddressInfo).port
					this.server = server
					console.log("AuthHandler: Server started on port", this.port)
					this.updateTimeout()
					this.serverCreationPromise = null
					resolve()
				})

				server.on("error", (error) => {
					console.error("AuthHandler: Server error", error)
					this.server = null
					this.port = 0
					this.serverCreationPromise = null
					reject(error)
				})
			} catch (error) {
				console.error("AuthHandler: Failed to create server", error)
				this.server = null
				this.port = 0
				this.serverCreationPromise = null
				reject(error)
			}
		})
	}

	private updateTimeout(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
		}

		this.timeoutId = setTimeout(() => this.stop(), SERVER_TIMEOUT)
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		console.log("AuthTokenHandler: Received request", req.url)

		if (!req.url) {
			this.sendResponse(res, 404, "text/plain", "Not found")
			return
		}

		try {
			// Convert HTTP URL to vscode.Uri and use shared handler directly
			const fullUrl = `http://127.0.0.1:${this.port}${req.url}`
			const uri = SharedUriHandler.convertHttpUrlToUri(fullUrl)

			// Use SharedUriHandler directly - it handles all validation and processing
			const success = await SharedUriHandler.handleUri(uri)

			if (success) {
				this.sendResponse(res, 200, "text/html", TOKEN_REQUEST_VIEW)
			} else {
				this.sendResponse(res, 400, "text/plain", "Bad request")
			}
		} catch (error) {
			console.error("AuthTokenHandler: Error processing request", error)
			this.sendResponse(res, 400, "text/plain", "Bad request")
		} finally {
			// Stop the server after handling any request (success or failure)
			this.stop()
		}
	}

	private sendResponse(res: ServerResponse, status: number, type: string, content: string): void {
		res.writeHead(status, { "Content-Type": type })
		res.end(content)
	}

	private async openBrowser(callbackUrl: URL): Promise<void> {
		await openExternal(callbackUrl.toString())
	}

	public stop(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
			this.timeoutId = null
		}

		if (this.server) {
			this.server.close()
			this.server = null
		}

		this.serverCreationPromise = null
		this.port = 0
	}

	public dispose(): void {
		this.stop()
	}
}

const TOKEN_REQUEST_VIEW = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cline - Authentication Success</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 90%;
        }
        
        .checkmark {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #4CAF50;
            margin: 0 auto 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: scaleIn 0.5s ease-out;
        }
        
        .checkmark::after {
            content: '✓';
            font-size: 40px;
            color: white;
            font-weight: bold;
        }
        
        h1 {
            font-size: 2.2rem;
            margin-bottom: 20px;
            font-weight: 600;
            opacity: 0;
            animation: fadeInUp 0.6s ease-out 0.2s forwards;
        }
        
        p {
            font-size: 1.1rem;
            line-height: 1.6;
            margin-bottom: 30px;
            opacity: 0.9;
            opacity: 0;
            animation: fadeInUp 0.6s ease-out 0.4s forwards;
        }
        
        .countdown {
            font-size: 0.9rem;
            opacity: 0.8;
            background: rgba(255, 255, 255, 0.1);
            padding: 10px 20px;
            border-radius: 25px;
            display: inline-block;
            opacity: 0;
            animation: fadeInUp 0.6s ease-out 0.6s forwards;
        }
        
        @keyframes scaleIn {
            0% {
                transform: scale(0);
            }
            100% {
                transform: scale(1);
            }
        }
        
        @keyframes fadeInUp {
            0% {
                opacity: 0;
                transform: translateY(30px);
            }
            100% {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @media (max-width: 480px) {
            .container {
                padding: 30px 20px;
            }
            
            h1 {
                font-size: 1.8rem;
            }
            
            p {
                font-size: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark"></div>
        <h1>Token Sent Successfully!</h1>
        <p>Your authentication token has been securely sent back to your IDE. You can now return to your development environment to continue working.</p>
        <div class="countdown">This window will close automatically in <span id="timer">5</span> seconds</div>
    </div>

    <script>
        let countdown = 5;
        const timerElement = document.getElementById('timer');
        
        const interval = setInterval(() => {
            countdown--;
            timerElement.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(interval);
                window.close();
            }
        }, 1000);
        
        // Fallback: if window.close() doesn't work (some browsers block it),
        // try to redirect to about:blank or show a message
        setTimeout(() => {
            try {
                window.close();
            } catch (e) {
                // If window.close() fails, redirect to a blank page
                window.location.href = 'about:blank';
            }
        }, 5000);
    </script>
</body>
</html>`
