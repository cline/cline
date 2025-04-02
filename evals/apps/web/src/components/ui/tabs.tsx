"use client"

import * as React from "react"
import { useEffect, useRef, useState } from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
	React.ComponentRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
	const [indicatorStyle, setIndicatorStyle] = useState({
		left: 0,
		top: 0,
		width: 0,
		height: 0,
	})

	const tabsListRef = useRef<HTMLDivElement | null>(null)

	const updateIndicator = React.useCallback(() => {
		if (!tabsListRef.current) {
			return
		}

		const activeTab = tabsListRef.current.querySelector<HTMLElement>('[data-state="active"]')

		if (!activeTab) {
			return
		}

		const activeRect = activeTab.getBoundingClientRect()
		const tabsRect = tabsListRef.current.getBoundingClientRect()

		requestAnimationFrame(() => {
			setIndicatorStyle({
				left: activeRect.left - tabsRect.left,
				top: activeRect.top - tabsRect.top,
				width: activeRect.width,
				height: activeRect.height,
			})
		})
	}, [])

	useEffect(() => {
		const timeoutId = setTimeout(updateIndicator, 0)

		window.addEventListener("resize", updateIndicator)
		const observer = new MutationObserver(updateIndicator)

		if (tabsListRef.current) {
			observer.observe(tabsListRef.current, {
				attributes: true,
				childList: true,
				subtree: true,
			})
		}

		return () => {
			clearTimeout(timeoutId)
			window.removeEventListener("resize", updateIndicator)
			observer.disconnect()
		}
	}, [updateIndicator])

	return (
		<div className="relative" ref={tabsListRef}>
			<TabsPrimitive.List
				ref={ref}
				className={cn(
					"relative inline-flex items-center justify-center rounded-sm bg-primary p-0.5 text-muted-foreground",
					className,
				)}
				{...props}
			/>
			<div
				className={cn(
					"absolute rounded-sm transition-all duration-300 ease-in-out pointer-events-none",
					"bg-accent/5",
				)}
				style={indicatorStyle}
			/>
		</div>
	)
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
	React.ComponentRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={cn(
			"inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 z-10",
			"data-[state=active]:text-accent data-[state=active]:font-medium cursor-pointer",
			className,
		)}
		{...props}
	/>
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
	React.ComponentRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn(
			"mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
			className,
		)}
		{...props}
	/>
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsContent, TabsList, TabsTrigger }
