import './HedgehogBuddy.scss'

import clsx from 'clsx'
import { ForwardedRef, useEffect, useRef, useState } from 'react'
import React from 'react'

import {
    AccessoryInfo,
    AnimationName,
    HedgehogSkin,
    OverlayAnimationName,
    overlayAnimations,
    SHADOW_HEIGHT,
    skins,
    SPRITE_SHEET_WIDTH,
    SPRITE_SIZE,
    spriteAccessoryUrl,
    SpriteInfo,
    spriteOverlayUrl,
    spriteUrl,
    standardAccessories,
} from './sprites/sprites'
import { range, sampleOne, shouldIgnoreInput } from '../../utils/utils'

export const X_FRAMES = SPRITE_SHEET_WIDTH / SPRITE_SIZE
export const FPS = 24
const GRAVITY_PIXELS = 10
const MAX_JUMP_COUNT = 2

export type HedgehogColorOptions =
    | 'green'
    | 'red'
    | 'blue'
    | 'purple'
    | 'dark'
    | 'light'
    | 'sepia'
    | 'invert'
    | 'invert-hue'
    | 'greyscale'

export interface MinimalHedgehogConfig {
    use_as_profile: boolean
    color: HedgehogColorOptions | null
    accessories: string[]
}

export interface HedgehogConfig extends MinimalHedgehogConfig {
    enabled: boolean
    color: HedgehogColorOptions | null
    skin?: HedgehogSkin
    accessories: string[]
    walking_enabled: boolean
    interactions_enabled: boolean
    controls_enabled: boolean
    party_mode_enabled: boolean
}

export const COLOR_TO_FILTER_MAP: Record<HedgehogColorOptions, string> = {
    red: 'hue-rotate(340deg) saturate(300%) brightness(90%)',
    green: 'hue-rotate(60deg) saturate(100%)',
    blue: 'hue-rotate(210deg) saturate(300%) brightness(90%)',
    purple: 'hue-rotate(240deg)',
    dark: 'brightness(70%)',
    light: 'brightness(130%)',
    sepia: 'sepia(100%) saturate(300%) brightness(70%)',
    invert: 'invert(100%)',
    'invert-hue': 'invert(100%) hue-rotate(180deg)',
    greyscale: 'saturate(0%)',
}

export type HedgehogBuddyProps = {
    onActorLoaded?: (actor: HedgehogActor) => void
    onClose?: (actor: HedgehogActor) => void
    onClick?: (actor: HedgehogActor) => void
    onPositionChange?: (actor: HedgehogActor) => void
    hedgehogConfig?: HedgehogConfig
    tooltip?: JSX.Element
    static?: boolean
}

type Box = {
    // Simplified rect based on bottom left xy and width/height
    x: number
    y: number
    width: number
    height: number
}

const elementToBox = (element: Element): Box => {
    if (element === document.body) {
        // It is easier to treat the floor as a box below the screen for simpler calculations
        return {
            x: 0,
            y: -1000,
            width: window.innerWidth,
            height: 1000,
        }
    }
    const isHedgehog = element.classList.contains('HedgehogBuddy')
    const rect = element.getBoundingClientRect()
    return {
        x: rect.left + (isHedgehog ? 20 : 0),
        y: window.innerHeight - rect.bottom + (isHedgehog ? 5 : 0),
        width: rect.width - (isHedgehog ? 40 : 0),
        height: rect.height - (isHedgehog ? 30 : 0),
    }
}

type AnimationState = {
    name: string
    frame: number
    iterations: number | null
    spriteInfo: SpriteInfo
    onComplete?: () => boolean | void
}

export class HedgehogActor {
    element?: HTMLDivElement | null
    direction: 'left' | 'right' = 'right'
    x = 0
    y = 0
    followMouse = false
    lastKnownMousePosition: [number, number] | null = null
    isDragging = false
    isControlledByUser = false
    yVelocity = -30 // Appears as if jumping out of thin air
    xVelocity = 0
    ground: Element | null = null
    jumpCount = 0
    mainAnimation: AnimationState | null = null
    overlayAnimation: AnimationState | null = null
    gravity = GRAVITY_PIXELS
    ignoreGroundAboveY?: number
    showTooltip = false
    lastScreenPosition = [window.screenX, window.screenY + window.innerHeight]
    static = false

    // properties synced with the logic
    hedgehogConfig: Partial<HedgehogConfig> = {}
    tooltip?: JSX.Element

    constructor() {
        this.log('Created new HedgehogActor')

        this.x = Math.min(Math.max(0, Math.floor(Math.random() * window.innerWidth)), window.innerWidth - SPRITE_SIZE)
        this.y = Math.min(Math.max(0, Math.floor(Math.random() * window.innerHeight)), window.innerHeight - SPRITE_SIZE)
        this.preloadAnimationSprites()
        this.setAnimation('fall')
    }

    animations(): { [key: string]: SpriteInfo } {
        const animations = skins[this.hedgehogConfig.skin || 'default']
        return animations
    }

    preloadAnimationSprites(): void {
        for (const animation of Object.values(this.animations())) {
            const preload = document.createElement('link')
            preload.rel = 'preload'
            preload.as = 'image'
            preload.href = spriteUrl(this.hedgehogConfig.skin || 'default', animation.img)
            document.head.appendChild(preload)
        }
    }

    private accessories(): AccessoryInfo[] {
        return this.hedgehogConfig.accessories?.map((acc) => standardAccessories[acc]) ?? []
    }

    private log(message: string, ...args: any[]): void {
        if ((window as any)._posthogDebugHedgehog) {
            console.log(`[HedgehogActor] ${message}`, ...args)
        }
    }

    setOnFire(times = 3): void {
        this.log('setting on fire, iterations remaining:', times)
        this.setOverlayAnimation('fire', {
            onComplete: () => {
                if (times == 1) {
                    this.setOverlayAnimation(null)
                } else {
                    this.setOnFire(times - 1)
                }
            },
        })

        this.setAnimation('stop', {})
        this.direction = sampleOne(['left', 'right'])
        this.xVelocity = this.direction === 'left' ? -5 : 5
        this.jump()
    }

    setupKeyboardListeners(): () => void {
        const lastKeys: string[] = []

        const secretMap: {
            keys: string[]
            action: () => void
        }[] = [
            {
                keys: ['f', 'f', 'f'],
                action: () => this.setOnFire(),
            },
            {
                keys: ['f', 'i', 'r', 'e'],
                action: () => this.setOnFire(),
            },
            {
                keys: ['s', 'p', 'i', 'd', 'e', 'r', 'h', 'o', 'g'],
                action: () => {
                    this.hedgehogConfig.skin = 'spiderhog'
                },
            },
            {
                keys: [
                    'arrowup',
                    'arrowup',
                    'arrowdown',
                    'arrowdown',
                    'arrowleft',
                    'arrowright',
                    'arrowleft',
                    'arrowright',
                    'b',
                    'a',
                ],
                action: () => {
                    this.setOnFire()
                    this.gravity = -2

                    setTimeout(() => {
                        this.gravity = GRAVITY_PIXELS
                    }, 2000)
                },
            },
        ]

        const keyDownListener = (e: KeyboardEvent): void => {
            if (shouldIgnoreInput(e) || !this.hedgehogConfig.controls_enabled) {
                return
            }

            const key = e.key.toLowerCase()

            lastKeys.push(key)
            if (lastKeys.length > 20) {
                lastKeys.shift()
            }

            if ([' ', 'w', 'arrowup'].includes(key)) {
                this.jump()
            }

            secretMap.forEach((secret) => {
                if (lastKeys.slice(-secret.keys.length).join('') === secret.keys.join('')) {
                    secret.action()
                    lastKeys.splice(-secret.keys.length)
                }
            })

            if (['arrowdown', 's'].includes(key)) {
                if (this.ground === document.body) {
                    if (this.mainAnimation?.name !== 'wave') {
                        this.setAnimation('wave')
                    }
                } else if (this.ground) {
                    const box = elementToBox(this.ground)
                    this.ignoreGroundAboveY = box.y + box.height - SPRITE_SIZE
                    this.ground = null
                    this.setAnimation('fall')
                }
            }

            if (['arrowleft', 'a', 'arrowright', 'd'].includes(key)) {
                this.isControlledByUser = true
                if (this.mainAnimation?.name !== 'walk') {
                    this.setAnimation('walk')
                }

                this.direction = ['arrowleft', 'a'].includes(key) ? 'left' : 'right'
                this.xVelocity = this.direction === 'left' ? -5 : 5

                const moonwalk = e.shiftKey
                if (moonwalk) {
                    this.direction = this.direction === 'left' ? 'right' : 'left'
                    // Moonwalking is hard so he moves slightly slower of course
                    this.xVelocity *= 0.8
                }
            }
        }

        const keyUpListener = (e: KeyboardEvent): void => {
            if (shouldIgnoreInput(e) || !this.hedgehogConfig.controls_enabled) {
                return
            }

            const key = e.key.toLowerCase()

            if (['arrowleft', 'a', 'arrowright', 'd'].includes(key)) {
                this.setAnimation('stop', {
                    iterations: FPS * 2,
                })
                this.isControlledByUser = false
            }
        }

        const onMouseDown = (e: MouseEvent): void => {
            if (!this.hedgehogConfig.controls_enabled || this.hedgehogConfig.skin !== 'spiderhog') {
                return
            }

            // Whilst the mouse is down we will move the hedgehog towards it
            // First check that we haven't clicked the hedgehog
            const elementBounds = this.element?.getBoundingClientRect()
            if (
                elementBounds &&
                e.clientX >= elementBounds.left &&
                e.clientX <= elementBounds.right &&
                e.clientY >= elementBounds.top &&
                e.clientY <= elementBounds.bottom
            ) {
                return
            }

            this.setAnimation('fall')
            this.followMouse = true
            this.lastKnownMousePosition = [e.clientX, e.clientY]

            const onMouseMove = (e: MouseEvent): void => {
                this.lastKnownMousePosition = [e.clientX, e.clientY]
            }

            const onMouseUp = (): void => {
                this.followMouse = false
                window.removeEventListener('mousemove', onMouseMove)
            }

            window.addEventListener('mousemove', onMouseMove)
            window.addEventListener('mouseup', onMouseUp)
        }

        window.addEventListener('keydown', keyDownListener)
        window.addEventListener('keyup', keyUpListener)
        window.addEventListener('mousedown', onMouseDown)

        return () => {
            window.removeEventListener('keydown', keyDownListener)
            window.removeEventListener('keyup', keyUpListener)
        }
    }

    setAnimation(animationName: AnimationName, options?: Partial<AnimationState>): void {
        const availableAnimations = this.animations()
        animationName = availableAnimations[animationName] ? animationName : 'stop'
        const spriteInfo = availableAnimations[animationName]

        this.mainAnimation = {
            name: animationName,
            frame: 0,
            iterations: spriteInfo.maxIteration ?? null,
            spriteInfo,
            onComplete: options?.onComplete,
        }

        // Set a random number of iterations or infinite for certain situations
        this.mainAnimation.iterations =
            options?.iterations ??
            (spriteInfo.maxIteration ? Math.max(1, Math.floor(Math.random() * spriteInfo.maxIteration)) : null)

        if (this.mainAnimation.name !== 'stop') {
            this.direction = this.mainAnimation.spriteInfo.forceDirection || sampleOne(['left', 'right'])
        }

        if (animationName === 'walk') {
            this.xVelocity = this.direction === 'left' ? -1 : 1
        } else if (animationName === 'stop' && !this.isControlledByUser) {
            this.xVelocity = 0
        }

        if ((window as any)._posthogDebugHedgehog) {
            const duration =
                this.mainAnimation.iterations !== null
                    ? this.mainAnimation.iterations * spriteInfo.frames * (1000 / FPS)
                    : '∞'

            this.log(`Will '${this.mainAnimation.name}' for ${duration}ms`)
        }
    }

    setOverlayAnimation(
        animationName: OverlayAnimationName | null,
        options?: {
            onComplete: () => boolean | void
        }
    ): void {
        if (!animationName) {
            this.overlayAnimation = null
            return
        }
        const spriteInfo = overlayAnimations[animationName]
        if (!spriteInfo) {
            this.log(`Overlay animation '${animationName}' not found`)
            return
        }

        this.overlayAnimation = {
            name: animationName,
            frame: 0,
            iterations: 1,
            spriteInfo,
            onComplete: options?.onComplete ?? (() => this.setOverlayAnimation(null)),
        }
    }

    setRandomAnimation(): void {
        if (this.mainAnimation?.name !== 'stop') {
            this.setAnimation('stop')
        } else {
            let randomChoiceList = Object.keys(this.animations()).reduce((acc, key) => {
                return [...acc, ...range(this.animations()[key].randomChance || 0).map(() => key)] as AnimationName[]
            }, [] as AnimationName[])

            randomChoiceList = this.hedgehogConfig.walking_enabled
                ? randomChoiceList
                : randomChoiceList.filter((x) => x !== 'walk')
            this.setAnimation(sampleOne(randomChoiceList))
        }
    }

    jump(): void {
        if (this.jumpCount >= MAX_JUMP_COUNT) {
            return
        }
        this.ground = null
        this.jumpCount += 1
        this.yVelocity = this.gravity * 5
    }

    update(): void {
        // Get the velocity of the screen changing
        const screenPosition = [window.screenX, window.screenY + window.innerHeight]

        const [screenMoveX, screenMoveY] = [
            screenPosition[0] - this.lastScreenPosition[0],
            screenPosition[1] - this.lastScreenPosition[1],
        ]

        this.lastScreenPosition = screenPosition

        if (screenMoveX || screenMoveY) {
            this.ground = null
            // Offset the hedgehog by the screen movement
            this.x -= screenMoveX
            // Add the screen movement to the y velocity
            this.y += screenMoveY
            // Bit of a hack but it works to avoid the moving screen affecting the hedgehog
            this.ignoreGroundAboveY = -10000

            if (screenMoveY < 0) {
                // If the ground has moved up relative to the hedgehog we need to make him jump
                this.yVelocity = Math.max(this.yVelocity + screenMoveY * 10, -this.gravity * 20)
            }

            if (screenMoveX !== 0) {
                if (this.mainAnimation?.name !== 'stop') {
                    this.setAnimation('stop')
                }
                // Somewhat random numbers here to find what felt fun
                this.xVelocity = Math.max(Math.min(this.xVelocity + screenMoveX * 10, 200), -200)
            }
        }

        this.applyVelocity()

        if (this.mainAnimation) {
            // Ensure we are falling or not
            if (this.mainAnimation.name === 'fall' && !this.isFalling()) {
                this.setAnimation('stop')
            }

            this.mainAnimation.frame++

            if (this.mainAnimation.frame >= this.mainAnimation.spriteInfo.frames) {
                this.mainAnimation.frame = 0
                // End of the animation
                if (this.mainAnimation.iterations !== null) {
                    this.mainAnimation.iterations -= 1
                }

                if (this.mainAnimation.iterations === 0) {
                    this.mainAnimation.iterations = null
                    // End of the animation, set the next one

                    const preventNextAnimation = this.mainAnimation.onComplete?.()

                    if (!preventNextAnimation) {
                        if (this.static) {
                            this.setAnimation('stop')
                        } else {
                            this.setRandomAnimation()
                        }
                    }
                }
            }
        }

        if (this.overlayAnimation) {
            this.overlayAnimation.frame++

            if (this.overlayAnimation.frame >= this.overlayAnimation.spriteInfo.frames) {
                this.overlayAnimation.frame = 0
                // End of the animation
                if (this.overlayAnimation.iterations !== null) {
                    this.overlayAnimation.iterations -= 1
                }

                if (this.overlayAnimation.iterations === 0) {
                    this.overlayAnimation.iterations = null
                    this.overlayAnimation.onComplete?.()
                }
            }
        }

        if (this.isDragging) {
            return
        }

        this.x = this.x + this.xVelocity

        if (this.x < 0) {
            this.x = 0
            if (!this.isControlledByUser) {
                this.xVelocity = -this.xVelocity
                this.direction = 'right'
            }
        }

        if (this.x > window.innerWidth - SPRITE_SIZE) {
            this.x = window.innerWidth - SPRITE_SIZE
            if (!this.isControlledByUser) {
                this.xVelocity = -this.xVelocity
                this.direction = 'left'
            }
        }
    }

    private applyVelocity(): void {
        if (this.isDragging) {
            this.ground = null
            return
        }

        if (this.followMouse) {
            this.ground = null
            const [clientX, clientY] = this.lastKnownMousePosition ?? [0, 0]

            const xDiff = clientX - this.x
            const yDiff = window.innerHeight - clientY - this.y

            const distance = Math.sqrt(xDiff ** 2 + yDiff ** 2)
            const speed = 3
            const ratio = speed / distance

            if (yDiff < 0) {
                this.yVelocity -= this.gravity
            }

            this.yVelocity += yDiff * ratio
            this.xVelocity += xDiff * ratio
            this.y = this.y + this.yVelocity
            if (this.y < 0) {
                this.y = 0
                this.yVelocity = -this.yVelocity * 0.4
            }
            this.x = this.x + this.xVelocity
            this.direction = this.xVelocity > 0 ? 'right' : 'left'

            return
        }

        this.ground = this.findGround()
        this.yVelocity -= this.gravity

        // We decelerate the x velocity if the hedgehog is stopped
        if (!this.isControlledByUser && this.mainAnimation?.name !== 'walk' && this.onGround()) {
            this.xVelocity = this.xVelocity * 0.6
        }

        let newY = this.y + this.yVelocity

        if (this.yVelocity < 0) {
            // We are falling - detect ground
            const groundBoundingRect = elementToBox(this.ground)
            const groundY = groundBoundingRect.y + groundBoundingRect.height

            if (newY <= groundY) {
                newY = groundY
                this.yVelocity = -this.yVelocity * 0.4

                // Clear flags as we have hit the ground
                this.ignoreGroundAboveY = undefined
                this.jumpCount = 0
            }
        } else {
            // If we are going up we can reset the ground
            this.ground = null
        }

        this.y = newY
    }

    private findGround(): Element {
        // We reset the ground when he is moved or x changes

        if (!this.hedgehogConfig.interactions_enabled || !this.element || this.y <= 0) {
            return document.body
        }

        const hedgehogBox = elementToBox(this.element)

        if (this.ground && this.ground !== document.body) {
            // Check if the current ground is still valid - if so we stick with it to stop flickering
            const groundBoundingRect = elementToBox(this.ground)

            if (
                hedgehogBox.x + hedgehogBox.width > groundBoundingRect.x &&
                hedgehogBox.x < groundBoundingRect.x + groundBoundingRect.width &&
                // Check still on screen
                groundBoundingRect.y + groundBoundingRect.height + hedgehogBox.height < window.innerHeight &&
                groundBoundingRect.y >= 0
            ) {
                // We are still on the same ground
                return this.ground
            }
        }

        // Only calculate block bounding rects once we need to
        const blocksWithBoxes: [Element, Box][] = Array.from(
            document.querySelectorAll(
                '.border, .border-t, .LemonButton--primary, .LemonButton--secondary:not(.LemonButton--status-alt:not(.LemonButton--active)), .LemonInput, .LemonSelect, .LemonTable, .HedgehogBuddy'
            )
        )
            .filter((x) => x !== this.element)
            .map((block) => [block, elementToBox(block)])

        // The highest candidate is our new ground
        let highestCandidate: [Element, Box] | null = null

        blocksWithBoxes.forEach(([block, box]) => {
            if (box.y + box.height > window.innerHeight || box.y < 0) {
                return
            }

            if (this.ignoreGroundAboveY && box.y + box.height > this.ignoreGroundAboveY) {
                return
            }

            const isAboveOrOn =
                hedgehogBox.x + hedgehogBox.width > box.x &&
                hedgehogBox.x < box.x + box.width &&
                hedgehogBox.y >= box.y + box.height

            if (isAboveOrOn) {
                if (!highestCandidate || box.y > highestCandidate[1].y) {
                    highestCandidate = [block, box]
                }
            }
        })

        return highestCandidate?.[0] ?? document.body
    }

    private onGround(): boolean {
        if (this.static) {
            return true
        }
        if (this.ground) {
            const groundLevel = elementToBox(this.ground).y + elementToBox(this.ground).height
            return this.y <= groundLevel
        }

        return false
    }

    private isFalling(): boolean {
        return !this.onGround() && Math.abs(this.yVelocity) > 1
    }

    renderRope(): JSX.Element | null {
        if (!this.lastKnownMousePosition) {
            return null
        }

        // We position the rope to roughly where the hand should be
        const x = this.x + SPRITE_SIZE / 2
        const y = this.y + SPRITE_SIZE / 2
        const mouseX = this.lastKnownMousePosition[0]
        // Y coords are inverted
        const mouseY = window.innerHeight - this.lastKnownMousePosition[1]

        return (
            <div
                className="border rounded bg-white pointer-events-none fixed z-[1000] origin-top-left"
                style={{
                    left: x,
                    bottom: y,
                    width: this.followMouse ? Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2) : 0,
                    height: 3,
                    transform: `rotate(${Math.atan2(y - mouseY, mouseX - x)}rad)`,
                }}
            />
        )
    }

    render({ onClick, ref }: { onClick: () => void; ref: ForwardedRef<HTMLDivElement> }): JSX.Element {
        const accessoryPosition = this.mainAnimation?.spriteInfo.accessoryPositions?.[this.mainAnimation.frame]
        const preloadContent =
            Object.values(this.animations())
                .map((x) => `url(${spriteUrl(this.hedgehogConfig.skin ?? 'default', x.img)})`)
                .join(' ') +
            ' ' +
            this.accessories()
                .map((accessory) => `url(${spriteAccessoryUrl(accessory.img)})`)
                .join(' ')

        const imageFilter = this.hedgehogConfig.color ? COLOR_TO_FILTER_MAP[this.hedgehogConfig.color] : undefined

        const onTouchOrMouseStart = (): void => {
            this.showTooltip = false
            let moved = false
            const lastPositions: [number, number, number][] = []

            // In your move handler, store timestamp along with positions

            const onMove = (e: TouchEvent | MouseEvent): void => {
                moved = true
                this.isDragging = true
                this.setAnimation('fall')

                const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
                const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

                this.x = clientX - SPRITE_SIZE / 2
                this.y = window.innerHeight - clientY - SPRITE_SIZE / 2

                lastPositions.push([clientX, clientY, Date.now()])
            }

            const onEnd = (): void => {
                if (!moved) {
                    onClick()
                }
                this.isDragging = false
                // get the velocity as an average of the last moves

                const relevantPositions = lastPositions.filter(([_x, _y, t]) => {
                    // We only consider the last 500ms but not the last 100ms (to avoid delays in letting go)
                    return t > Date.now() - 500 && t < Date.now() - 20
                })

                const [xPixelsPerSecond, yPixelsPerSecond] = relevantPositions.reduce(
                    ([x, y], [x2, y2, t2], i) => {
                        if (i === 0) {
                            return [0, 0]
                        }
                        const dt = (t2 - relevantPositions[i - 1][2]) / 1000
                        return [
                            x + (x2 - relevantPositions[i - 1][0]) / dt,
                            y + (y2 - relevantPositions[i - 1][1]) / dt,
                        ]
                    },

                    [0, 0]
                )

                if (relevantPositions.length) {
                    const maxVelocity = 250
                    this.xVelocity = Math.min(maxVelocity, xPixelsPerSecond / relevantPositions.length / FPS)
                    this.yVelocity = Math.min(maxVelocity, (yPixelsPerSecond / relevantPositions.length / FPS) * -1)
                }

                this.setAnimation('fall')
                window.removeEventListener('touchmove', onMove)
                window.removeEventListener('touchend', onEnd)
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onEnd)
            }

            window.addEventListener('touchmove', onMove)
            window.addEventListener('touchend', onEnd)
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onEnd)
        }

        return (
            <>
                <div
                    ref={(r) => {
                        this.element = r
                        if (r && typeof ref === 'function') {
                            ref?.(r)
                        }
                    }}
                    className="m-0 cursor-pointer HedgehogBuddy"
                    data-content={preloadContent}
                    onTouchStart={this.static ? undefined : () => onTouchOrMouseStart()}
                    onMouseDown={this.static ? undefined : () => onTouchOrMouseStart()}
                    onMouseOver={() => (this.showTooltip = true)}
                    onMouseOut={() => (this.showTooltip = false)}
                    onClick={this.static ? onClick : undefined}
                    style={{
                        position: this.static ? 'relative' : 'fixed',
                        left: this.static ? undefined : this.x,
                        bottom: this.static ? undefined : this.y - SHADOW_HEIGHT * 0.5,
                        transition: !(this.isDragging || this.followMouse) ? `all ${1000 / FPS}ms` : undefined,
                    }}
                >
                    {this.tooltip && !this.isDragging && (
                        <div
                            className={clsx(
                                'rounded transition-all absolute -top-10 left-1/2 -translate-x-1/2 pointer-events-none',
                                this.showTooltip ? 'opacity-100' : 'opacity-0  translate-y-10'
                            )}
                            style={{
                                // NOTE: Some styles done here to avoid it showing as an interactable element (via border)
                                border: '1px solid var(--border-primary)',
                                backgroundColor: 'var(--bg-surface-primary)',
                            }}
                        >
                            {this.tooltip}
                        </div>
                    )}
                    <div
                        style={{
                            transform: `scaleX(${this.direction === 'right' ? 1 : -1})`,
                        }}
                    >
                        {this.mainAnimation ? (
                            <div
                                className="rendering-pixelated"
                                style={{
                                    width: SPRITE_SIZE,
                                    height: SPRITE_SIZE,
                                    backgroundImage: `url(${spriteUrl(
                                        this.hedgehogConfig.skin ?? 'default',
                                        this.mainAnimation.spriteInfo.img
                                    )})`,
                                    backgroundPosition: `-${(this.mainAnimation.frame % X_FRAMES) * SPRITE_SIZE}px -${
                                        Math.floor(this.mainAnimation.frame / X_FRAMES) * SPRITE_SIZE
                                    }px`,
                                    backgroundSize: (SPRITE_SIZE / SPRITE_SIZE) * X_FRAMES * 100 + '%',
                                    filter: imageFilter as any,
                                    ...(this.mainAnimation.spriteInfo.style ?? {}),
                                }}
                            />
                        ) : null}

                        {this.accessories().map((accessory, index) => (
                            <div
                                className="absolute rendering-pixelated"
                                key={index}
                                style={{
                                    top: 0,
                                    left: 0,
                                    // NOTE: Don't use tailwind here as it can't pre-compute these values
                                    width: SPRITE_SIZE,
                                    height: SPRITE_SIZE,
                                    backgroundImage: `url(${spriteAccessoryUrl(accessory.img)})`,
                                    transform: accessoryPosition
                                        ? `translate3d(${accessoryPosition[0]}px, ${accessoryPosition[1]}px, 0)`
                                        : undefined,
                                    filter: imageFilter as any,
                                }}
                            />
                        ))}
                        {this.overlayAnimation ? (
                            <div
                                className="absolute rendering-pixelated"
                                style={{
                                    top: 0,
                                    left: 0,
                                    width: SPRITE_SIZE,
                                    height: SPRITE_SIZE,
                                    backgroundImage: `url(${spriteOverlayUrl(this.overlayAnimation.spriteInfo.img)})`,
                                    backgroundPosition: `-${
                                        (this.overlayAnimation.frame % X_FRAMES) * SPRITE_SIZE
                                    }px -${Math.floor(this.overlayAnimation.frame / X_FRAMES) * SPRITE_SIZE}px`,
                                    ...(this.overlayAnimation.spriteInfo.style ?? {}),
                                }}
                            />
                        ) : null}
                    </div>
                </div>
                {this.renderRope()}

                {(window as any)._posthogDebugHedgehog && (
                    <>
                        {[this.element && elementToBox(this.element), this.ground && elementToBox(this.ground)].map(
                            (box, i) => {
                                if (!box) {
                                    return
                                }
                                return (
                                    <div
                                        key={i}
                                        className="fixed pointer-events-none"
                                        style={{
                                            outline: '1px solid red',
                                            top: window.innerHeight - box.y - box.height,
                                            left: box.x,
                                            width: box.width,
                                            height: box.height,
                                        }}
                                    />
                                )
                            }
                        )}
                    </>
                )}
            </>
        )
    }
}

export const HedgehogBuddy = React.forwardRef<HTMLDivElement, HedgehogBuddyProps>(function HedgehogBuddy(
    { onActorLoaded, onClick: _onClick, onPositionChange, hedgehogConfig, tooltip, static: staticMode },
    ref
): JSX.Element {
    const actorRef = useRef<HedgehogActor>()

    if (!actorRef.current) {
        actorRef.current = new HedgehogActor()
        onActorLoaded?.(actorRef.current)
    }

    const actor = actorRef.current
    const [_, setTimerLoop] = useState(0)

    useEffect(() => {
        if (hedgehogConfig) {
            actor.hedgehogConfig = hedgehogConfig
            actor.setAnimation(hedgehogConfig.walking_enabled ? 'walk' : 'stop')
        }
    }, [hedgehogConfig])

    useEffect(() => {
        actor.tooltip = tooltip
    }, [tooltip])

    useEffect(() => {
        actor.static = staticMode ?? false
    }, [staticMode])

    useEffect(() => {
        let timer: any = null

        const loop = (): void => {
            actor.update()
            setTimerLoop((x) => x + 1)
            timer = setTimeout(loop, 1000 / FPS)
        }

        loop()
        return () => {
            clearTimeout(timer)
        }
    }, [])

    useEffect(() => {
        if (actor.isDragging) {
            document.body.classList.add('select-none')
        } else {
            document.body.classList.remove('select-none')
        }

        return () => document.body.classList.remove('select-none')
    }, [actor.isDragging])

    useEffect(() => {
        onPositionChange?.(actor)
    }, [actor.x, actor.y, actor.direction])

    const onClick = (): void => {
        if (!actor.isDragging) {
            _onClick?.(actor)
        }
    }

    return actor.render({ onClick, ref })
})
