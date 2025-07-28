import type { IncomingMessage, Server, ServerResponse } from "node:http"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { clineEnvConfig } from "@/config"
import { openExternal } from "@/utils/env"

const SERVER_TIMEOUT = 10 * 60 * 1000

/**
 * Handles OAuth authentication flow by creating a local server to receive tokens.
 */
export class AuthHandler {
	private port = 0
	private server: Server | null = null

	public static callbackHandler: (uri: string) => Promise<void>

	public start(): string | undefined {
		try {
			if (this.server) {
				const authUrl = this.getBrowserAuthUrl()
				console.error("AuthTokenHandler: Server already running")
				this.openBrowser(authUrl)
				return authUrl.href
			}

			this.createServer()
			const authUrl = this.getBrowserAuthUrl()
			return authUrl.href
		} catch (error) {
			console.error("AuthTokenHandler.start error:", error)
			return undefined
		}
	}

	private createServer(): void {
		const server = http.createServer(this.handleRequest.bind(this))

		server.listen(0, "127.0.0.1", () => {
			this.port = (server.address() as AddressInfo).port
			this.server = server
			console.error("AuthTokenHandler: Server started on port", this.port)

			const callbackUrl = this.getBrowserAuthUrl()
			this.openBrowser(callbackUrl)
			setTimeout(() => this.stop(), SERVER_TIMEOUT)
		})

		server.on("error", (error) => {
			console.error("AuthTokenHandler: Server error", error)
		})
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		console.log("AuthTokenHandler: Received request", req.url)
		if (!req.url || !req.url?.startsWith("/auth?idToken=")) {
			this.sendResponse(res, 404, "text/plain", "Not found")
			return
		}
		try {
			const url = new URL(req.url, `http://127.0.0.1:${this.port}`)

			// Convert URL to vscode.Uri for the callback
			await AuthHandler.callbackHandler?.(url.toString())
			this.sendResponse(res, 200, "text/html", TOKEN_REQUEST_VIEW)
		} catch (error) {
			console.error("AuthTokenHandler: Error handling request", error)
			this.sendResponse(res, 400, "text/plain", "Token not found")
		} finally {
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

	private getBrowserAuthUrl(): URL {
		try {
			if (!clineEnvConfig.appBaseUrl) {
				throw new Error("clineEnvConfig.appBaseUrl is undefined")
			}
			const baseUrl = new URL(clineEnvConfig.appBaseUrl)
			baseUrl.pathname = "/auth"
			baseUrl.searchParams.set("callback_url", `http://127.0.0.1:${this.port}/auth`)
			return baseUrl
		} catch (error) {
			console.error("Error creating browser auth URL:", error)
			throw error
		}
	}

	public stop(): void {
		if (this.server) {
			this.server.close()
			this.server = null
			this.port = 0
		}
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

let _authHandler: AuthHandler | null = null

export async function getAuthHandler(authUrlString: string): Promise<void> {
	if (_authHandler) {
		_authHandler.start()
		return
	}
	await openExternal(authUrlString)
}

/**
 * Sets the AuthHandler instance for non-vscode environments.
 */
export function setAuthHandler(): void {
	_authHandler = new AuthHandler()
}
