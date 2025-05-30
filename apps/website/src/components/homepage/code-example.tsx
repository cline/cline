"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"

export function CodeExample() {
	const [currentMode, setCurrentMode] = useState<"code" | "architect" | "debug">("code")
	const [isTyping, setIsTyping] = useState(false)
	const [currentText, setCurrentText] = useState("")
	const [textIndex, setTextIndex] = useState(0)
	const codeContainerRef = useRef<HTMLPreElement>(null)

	// simulate typing effect
	useEffect(() => {
		if (isTyping && textIndex < codeExamples[currentMode].code.length) {
			const timer = setTimeout(() => {
				setCurrentText((prev) => prev + codeExamples[currentMode].code[textIndex])
				setTextIndex(textIndex + 1)

				// Auto-scroll to the bottom
				if (codeContainerRef.current) {
					codeContainerRef.current.scrollTop = codeContainerRef.current.scrollHeight
				}
			}, 15) // adjust speed as needed
			return () => clearTimeout(timer)
		} else if (textIndex >= codeExamples[currentMode].code.length) {
			setIsTyping(false)
			// switch to next mode after a delay
			const timer = setTimeout(() => {
				const nextMode = currentMode === "code" ? "architect" : currentMode === "architect" ? "debug" : "code"
				switchMode(nextMode)
			}, 1000) // wait a second before switching
			return () => clearTimeout(timer)
		}
	}, [isTyping, textIndex, currentMode])

	// switch modes with typing effect
	const switchMode = (mode: "code" | "architect" | "debug") => {
		setCurrentMode(mode)
		setCurrentText("")
		setTextIndex(0)
		setIsTyping(true)

		// Reset scroll position when switching modes
		if (codeContainerRef.current) {
			codeContainerRef.current.scrollTop = 0
		}
	}

	// start typing on initial load
	useEffect(() => {
		setIsTyping(true)
	}, [])

	return (
		<div className="relative z-10 w-full max-w-[90vw] rounded-lg border border-border bg-background/50 p-2 shadow-2xl backdrop-blur-sm sm:max-w-[500px]">
			<div className="rounded-md bg-muted p-1.5 dark:bg-gray-900 sm:p-2">
				<div className="flex items-center justify-between border-b border-border px-2 py-1.5 sm:px-3 sm:py-2">
					<div className="flex items-center space-x-1.5">
						<div className="h-2.5 w-2.5 rounded-full bg-red-500 sm:h-3 sm:w-3" />
						<div className="h-2.5 w-2.5 rounded-full bg-yellow-500 sm:h-3 sm:w-3" />
						<div className="h-2.5 w-2.5 rounded-full bg-green-500 sm:h-3 sm:w-3" />
					</div>
					<div className="flex space-x-1">
						<button
							onClick={() => switchMode("code")}
							className={`rounded px-2 py-0.5 text-xs font-medium transition-colors sm:text-sm ${currentMode === "code" ? "bg-blue-500/20 text-blue-400" : "text-gray-400 hover:bg-gray-800"}`}>
							Code
						</button>
						<button
							onClick={() => switchMode("architect")}
							className={`rounded px-2 py-0.5 text-xs font-medium transition-colors sm:text-sm ${currentMode === "architect" ? "bg-purple-500/20 text-purple-400" : "text-gray-400 hover:bg-gray-800"}`}>
							Architect
						</button>
						<button
							onClick={() => switchMode("debug")}
							className={`rounded px-2 py-0.5 text-xs font-medium transition-colors sm:text-sm ${currentMode === "debug" ? "bg-green-500/20 text-green-400" : "text-gray-400 hover:bg-gray-800"}`}>
							Debug
						</button>
					</div>
				</div>
				<div className="p-2 sm:p-4">
					<pre
						ref={codeContainerRef}
						className="scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent overflow-y-hidden text-xs text-muted-foreground max-lg:h-[25vh] sm:text-sm lg:max-h-[50vh]">
						<code className="block whitespace-pre font-mono">
							{currentText}
							{isTyping && (
								<motion.span
									animate={{ opacity: [1, 0] }}
									transition={{ repeat: Number.POSITIVE_INFINITY, duration: 0.8 }}
									className="inline-block h-4 w-2 bg-blue-500"
								/>
							)}
						</code>
					</pre>
				</div>
			</div>
		</div>
	)
}

const codeExamples = {
	code: {
		code: `// Code Mode
You: Generate a React component for a user profile card

Roo: Here's a React component for a user profile card:

import React from 'react';

interface UserProfileProps {
  name: string;
  role: string;
  avatar: string;
  bio: string;
  stats: {
    projects: number;
    followers: number;
    following: number;
  };
}

export const UserProfile: React.FC<UserProfileProps> = ({
  name,
  role,
  avatar,
  bio,
  stats
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-sm">
      <div className="flex items-center space-x-4">
        <img 
          src={avatar || "/placeholder.svg"} 
          alt={name} 
          className="w-16 h-16 rounded-full object-cover"
        />
        <div>
          <h3 className="text-xl font-bold">{name}</h3>
          <p className="text-gray-600">{role}</p>
        </div>
      </div>
      <p className="mt-4 text-gray-700">{bio}</p>
      <div className="mt-6 flex justify-between">
        <div className="text-center">
          <span className="block font-bold">{stats.projects}</span>
          <span className="text-sm text-gray-500">Projects</span>
        </div>
        <div className="text-center">
          <span className="block font-bold">{stats.followers}</span>
          <span className="text-sm text-gray-500">Followers</span>
        </div>
        <div className="text-center">
          <span className="block font-bold">{stats.following}</span>
          <span className="text-sm text-gray-500">Following</span>
        </div>
      </div>
    </div>
  );
};`,
	},
	architect: {
		code: `// Architect Mode
// Project: E-commerce Platform
// Request: Design the authentication system

Roo is analyzing your project...

📂 Recommended Architecture:

auth/
├─ services/
│  ├─ authService.ts       // Core authentication logic
│  ├─ tokenService.ts      // JWT handling and refresh
│  └─ userService.ts       // User data operations
├─ hooks/
│  ├─ useAuth.ts           // React hook for auth state
│  └─ useProtectedRoute.ts // Route protection
├─ components/
│  ├─ LoginForm.tsx        // Login UI
│  ├─ SignupForm.tsx       // Registration UI
│  ├─ PasswordReset.tsx    // Password recovery
│  └─ TwoFactorAuth.tsx    // 2FA implementation
└─ context/
   └─ AuthContext.tsx      // Global auth state

🔐 Security Recommendations:
- Implement PKCE flow for auth code exchange
- Use HttpOnly cookies for refresh tokens
- Rate limit authentication attempts
- Add device fingerprinting for suspicious login detection

⚡ Performance Considerations:
- Prefetch user data on auth
- Implement token refresh without UI disruption
- Lazy load auth components

Would you like me to generate any of these files?`,
	},
	debug: {
		code: `// Debug Mode
// Analyzing error: TypeError: Cannot read property 'map' of undefined

Roo has analyzed your code and found 3 issues:

🐛 Issue #1: Null data reference
  Line 42: const items = data.items.map(item => item.name);
  
  ✓ Root Cause: 'data' is undefined when component mounts
  ✓ Context: API request in useEffect hasn't completed yet
  
  Recommended Fix:
  const items = data?.items?.map(item => item.name) || [];

🐛 Issue #2: Missing dependency in useEffect
  Line 37: useEffect(() => { fetchData() }, []);
  
  ✓ Root Cause: fetchData depends on 'userId' but isn't in deps array
  ✓ Context: This causes stale data when userId changes
  
  Recommended Fix:
  useEffect(() => { fetchData() }, [userId, fetchData]);

🐛 Issue #3: Memory leak from unfinished API call
  Line 38: const response = await api.getItems(userId);
  
  ✓ Root Cause: No cleanup when component unmounts during API call
  ✓ Context: This triggers React warning in development
  
  Recommended Fix:
  Add AbortController to cancel pending requests on unmount

Apply these fixes automatically? [Yes/No]`,
	},
}
