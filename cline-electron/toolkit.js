/**
 * A reference to globalThis, with support
 * for browsers that don't yet support the spec.
 * @public
 */
const $global = (function () {
	if (typeof globalThis !== "undefined") {
		// We're running in a modern environment.
		return globalThis
	}
	if (typeof global !== "undefined") {
		// We're running in NodeJS
		return global
	}
	if (typeof self !== "undefined") {
		// We're running in a worker.
		return self
	}
	if (typeof window !== "undefined") {
		// We're running in the browser's main thread.
		return window
	}
	try {
		// Hopefully we never get here...
		// Not all environments allow eval and Function. Use only as a last resort:
		// eslint-disable-next-line no-new-func
		return new Function("return this")()
	} catch (_a) {
		// If all fails, give up and create an object.
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
		return {}
	}
})()
// API-only Polyfill for trustedTypes
if ($global.trustedTypes === void 0) {
	$global.trustedTypes = {
		createPolicy: (n, r) => r,
	}
}
const propConfig = {
	configurable: false,
	enumerable: false,
	writable: false,
}
if ($global.FAST === void 0) {
	Reflect.defineProperty(
		$global,
		"FAST",
		Object.assign(
			{
				value: Object.create(null),
			},
			propConfig,
		),
	)
}
/**
 * The FAST global.
 * @internal
 */
const FAST = $global.FAST
if (FAST.getById === void 0) {
	const storage = Object.create(null)
	Reflect.defineProperty(
		FAST,
		"getById",
		Object.assign(
			{
				value(id, initialize) {
					let found = storage[id]
					if (found === void 0) {
						found = initialize ? (storage[id] = initialize()) : null
					}
					return found
				},
			},
			propConfig,
		),
	)
}
/**
 * A readonly, empty array.
 * @remarks
 * Typically returned by APIs that return arrays when there are
 * no actual items to return.
 * @internal
 */
const emptyArray = Object.freeze([])
/**
 * Creates a function capable of locating metadata associated with a type.
 * @returns A metadata locator function.
 * @internal
 */
function createMetadataLocator() {
	const metadataLookup = new WeakMap()
	return function (target) {
		let metadata = metadataLookup.get(target)
		if (metadata === void 0) {
			let currentTarget = Reflect.getPrototypeOf(target)
			while (metadata === void 0 && currentTarget !== null) {
				metadata = metadataLookup.get(currentTarget)
				currentTarget = Reflect.getPrototypeOf(currentTarget)
			}
			metadata = metadata === void 0 ? [] : metadata.slice(0)
			metadataLookup.set(target, metadata)
		}
		return metadata
	}
}

const updateQueue = $global.FAST.getById(1 /* updateQueue */, () => {
	const tasks = []
	const pendingErrors = []
	function throwFirstError() {
		if (pendingErrors.length) {
			throw pendingErrors.shift()
		}
	}
	function tryRunTask(task) {
		try {
			task.call()
		} catch (error) {
			pendingErrors.push(error)
			setTimeout(throwFirstError, 0)
		}
	}
	function process() {
		const capacity = 1024
		let index = 0
		while (index < tasks.length) {
			tryRunTask(tasks[index])
			index++
			// Prevent leaking memory for long chains of recursive calls to `DOM.queueUpdate`.
			// If we call `DOM.queueUpdate` within a task scheduled by `DOM.queueUpdate`, the queue will
			// grow, but to avoid an O(n) walk for every task we execute, we don't
			// shift tasks off the queue after they have been executed.
			// Instead, we periodically shift 1024 tasks off the queue.
			if (index > capacity) {
				// Manually shift all values starting at the index back to the
				// beginning of the queue.
				for (let scan = 0, newLength = tasks.length - index; scan < newLength; scan++) {
					tasks[scan] = tasks[scan + index]
				}
				tasks.length -= index
				index = 0
			}
		}
		tasks.length = 0
	}
	function enqueue(callable) {
		if (tasks.length < 1) {
			$global.requestAnimationFrame(process)
		}
		tasks.push(callable)
	}
	return Object.freeze({
		enqueue,
		process,
	})
})
/* eslint-disable */
const fastHTMLPolicy = $global.trustedTypes.createPolicy("fast-html", {
	createHTML: (html) => html,
})
/* eslint-enable */
let htmlPolicy = fastHTMLPolicy
const marker = `fast-${Math.random().toString(36).substring(2, 8)}`
/** @internal */
const _interpolationStart = `${marker}{`
/** @internal */
const _interpolationEnd = `}${marker}`
/**
 * Common DOM APIs.
 * @public
 */
const DOM = Object.freeze({
	/**
	 * Indicates whether the DOM supports the adoptedStyleSheets feature.
	 */
	supportsAdoptedStyleSheets: Array.isArray(document.adoptedStyleSheets) && "replace" in CSSStyleSheet.prototype,
	/**
	 * Sets the HTML trusted types policy used by the templating engine.
	 * @param policy - The policy to set for HTML.
	 * @remarks
	 * This API can only be called once, for security reasons. It should be
	 * called by the application developer at the start of their program.
	 */
	setHTMLPolicy(policy) {
		if (htmlPolicy !== fastHTMLPolicy) {
			throw new Error("The HTML policy can only be set once.")
		}
		htmlPolicy = policy
	},
	/**
	 * Turns a string into trusted HTML using the configured trusted types policy.
	 * @param html - The string to turn into trusted HTML.
	 * @remarks
	 * Used internally by the template engine when creating templates
	 * and setting innerHTML.
	 */
	createHTML(html) {
		return htmlPolicy.createHTML(html)
	},
	/**
	 * Determines if the provided node is a template marker used by the runtime.
	 * @param node - The node to test.
	 */
	isMarker(node) {
		return node && node.nodeType === 8 && node.data.startsWith(marker)
	},
	/**
	 * Given a marker node, extract the {@link HTMLDirective} index from the placeholder.
	 * @param node - The marker node to extract the index from.
	 */
	extractDirectiveIndexFromMarker(node) {
		return parseInt(node.data.replace(`${marker}:`, ""))
	},
	/**
	 * Creates a placeholder string suitable for marking out a location *within*
	 * an attribute value or HTML content.
	 * @param index - The directive index to create the placeholder for.
	 * @remarks
	 * Used internally by binding directives.
	 */
	createInterpolationPlaceholder(index) {
		return `${_interpolationStart}${index}${_interpolationEnd}`
	},
	/**
	 * Creates a placeholder that manifests itself as an attribute on an
	 * element.
	 * @param attributeName - The name of the custom attribute.
	 * @param index - The directive index to create the placeholder for.
	 * @remarks
	 * Used internally by attribute directives such as `ref`, `slotted`, and `children`.
	 */
	createCustomAttributePlaceholder(attributeName, index) {
		return `${attributeName}="${this.createInterpolationPlaceholder(index)}"`
	},
	/**
	 * Creates a placeholder that manifests itself as a marker within the DOM structure.
	 * @param index - The directive index to create the placeholder for.
	 * @remarks
	 * Used internally by structural directives such as `repeat`.
	 */
	createBlockPlaceholder(index) {
		return `<!--${marker}:${index}-->`
	},
	/**
	 * Schedules DOM update work in the next async batch.
	 * @param callable - The callable function or object to queue.
	 */
	queueUpdate: updateQueue.enqueue,
	/**
	 * Immediately processes all work previously scheduled
	 * through queueUpdate.
	 * @remarks
	 * This also forces nextUpdate promises
	 * to resolve.
	 */
	processUpdates: updateQueue.process,
	/**
	 * Resolves with the next DOM update.
	 */
	nextUpdate() {
		return new Promise(updateQueue.enqueue)
	},
	/**
	 * Sets an attribute value on an element.
	 * @param element - The element to set the attribute value on.
	 * @param attributeName - The attribute name to set.
	 * @param value - The value of the attribute to set.
	 * @remarks
	 * If the value is `null` or `undefined`, the attribute is removed, otherwise
	 * it is set to the provided value using the standard `setAttribute` API.
	 */
	setAttribute(element, attributeName, value) {
		if (value === null || value === undefined) {
			element.removeAttribute(attributeName)
		} else {
			element.setAttribute(attributeName, value)
		}
	},
	/**
	 * Sets a boolean attribute value.
	 * @param element - The element to set the boolean attribute value on.
	 * @param attributeName - The attribute name to set.
	 * @param value - The value of the attribute to set.
	 * @remarks
	 * If the value is true, the attribute is added; otherwise it is removed.
	 */
	setBooleanAttribute(element, attributeName, value) {
		value ? element.setAttribute(attributeName, "") : element.removeAttribute(attributeName)
	},
	/**
	 * Removes all the child nodes of the provided parent node.
	 * @param parent - The node to remove the children from.
	 */
	removeChildNodes(parent) {
		for (let child = parent.firstChild; child !== null; child = parent.firstChild) {
			parent.removeChild(child)
		}
	},
	/**
	 * Creates a TreeWalker configured to walk a template fragment.
	 * @param fragment - The fragment to walk.
	 */
	createTemplateWalker(fragment) {
		return document.createTreeWalker(
			fragment,
			133,
			// element, text, comment
			null,
			false,
		)
	},
})

/**
 * An implementation of {@link Notifier} that efficiently keeps track of
 * subscribers interested in a specific change notification on an
 * observable source.
 *
 * @remarks
 * This set is optimized for the most common scenario of 1 or 2 subscribers.
 * With this in mind, it can store a subscriber in an internal field, allowing it to avoid Array#push operations.
 * If the set ever exceeds two subscribers, it upgrades to an array automatically.
 * @public
 */
class SubscriberSet {
	/**
	 * Creates an instance of SubscriberSet for the specified source.
	 * @param source - The object source that subscribers will receive notifications from.
	 * @param initialSubscriber - An initial subscriber to changes.
	 */
	constructor(source, initialSubscriber) {
		this.sub1 = void 0
		this.sub2 = void 0
		this.spillover = void 0
		this.source = source
		this.sub1 = initialSubscriber
	}
	/**
	 * Checks whether the provided subscriber has been added to this set.
	 * @param subscriber - The subscriber to test for inclusion in this set.
	 */
	has(subscriber) {
		return this.spillover === void 0
			? this.sub1 === subscriber || this.sub2 === subscriber
			: this.spillover.indexOf(subscriber) !== -1
	}
	/**
	 * Subscribes to notification of changes in an object's state.
	 * @param subscriber - The object that is subscribing for change notification.
	 */
	subscribe(subscriber) {
		const spillover = this.spillover
		if (spillover === void 0) {
			if (this.has(subscriber)) {
				return
			}
			if (this.sub1 === void 0) {
				this.sub1 = subscriber
				return
			}
			if (this.sub2 === void 0) {
				this.sub2 = subscriber
				return
			}
			this.spillover = [this.sub1, this.sub2, subscriber]
			this.sub1 = void 0
			this.sub2 = void 0
		} else {
			const index = spillover.indexOf(subscriber)
			if (index === -1) {
				spillover.push(subscriber)
			}
		}
	}
	/**
	 * Unsubscribes from notification of changes in an object's state.
	 * @param subscriber - The object that is unsubscribing from change notification.
	 */
	unsubscribe(subscriber) {
		const spillover = this.spillover
		if (spillover === void 0) {
			if (this.sub1 === subscriber) {
				this.sub1 = void 0
			} else if (this.sub2 === subscriber) {
				this.sub2 = void 0
			}
		} else {
			const index = spillover.indexOf(subscriber)
			if (index !== -1) {
				spillover.splice(index, 1)
			}
		}
	}
	/**
	 * Notifies all subscribers.
	 * @param args - Data passed along to subscribers during notification.
	 */
	notify(args) {
		const spillover = this.spillover
		const source = this.source
		if (spillover === void 0) {
			const sub1 = this.sub1
			const sub2 = this.sub2
			if (sub1 !== void 0) {
				sub1.handleChange(source, args)
			}
			if (sub2 !== void 0) {
				sub2.handleChange(source, args)
			}
		} else {
			for (let i = 0, ii = spillover.length; i < ii; ++i) {
				spillover[i].handleChange(source, args)
			}
		}
	}
}
/**
 * An implementation of Notifier that allows subscribers to be notified
 * of individual property changes on an object.
 * @public
 */
class PropertyChangeNotifier {
	/**
	 * Creates an instance of PropertyChangeNotifier for the specified source.
	 * @param source - The object source that subscribers will receive notifications from.
	 */
	constructor(source) {
		this.subscribers = {}
		this.sourceSubscribers = null
		this.source = source
	}
	/**
	 * Notifies all subscribers, based on the specified property.
	 * @param propertyName - The property name, passed along to subscribers during notification.
	 */
	notify(propertyName) {
		var _a
		const subscribers = this.subscribers[propertyName]
		if (subscribers !== void 0) {
			subscribers.notify(propertyName)
		}
		;(_a = this.sourceSubscribers) === null || _a === void 0 ? void 0 : _a.notify(propertyName)
	}
	/**
	 * Subscribes to notification of changes in an object's state.
	 * @param subscriber - The object that is subscribing for change notification.
	 * @param propertyToWatch - The name of the property that the subscriber is interested in watching for changes.
	 */
	subscribe(subscriber, propertyToWatch) {
		var _a
		if (propertyToWatch) {
			let subscribers = this.subscribers[propertyToWatch]
			if (subscribers === void 0) {
				this.subscribers[propertyToWatch] = subscribers = new SubscriberSet(this.source)
			}
			subscribers.subscribe(subscriber)
		} else {
			this.sourceSubscribers = (_a = this.sourceSubscribers) !== null && _a !== void 0 ? _a : new SubscriberSet(this.source)
			this.sourceSubscribers.subscribe(subscriber)
		}
	}
	/**
	 * Unsubscribes from notification of changes in an object's state.
	 * @param subscriber - The object that is unsubscribing from change notification.
	 * @param propertyToUnwatch - The name of the property that the subscriber is no longer interested in watching.
	 */
	unsubscribe(subscriber, propertyToUnwatch) {
		var _a
		if (propertyToUnwatch) {
			const subscribers = this.subscribers[propertyToUnwatch]
			if (subscribers !== void 0) {
				subscribers.unsubscribe(subscriber)
			}
		} else {
			;(_a = this.sourceSubscribers) === null || _a === void 0 ? void 0 : _a.unsubscribe(subscriber)
		}
	}
}

/**
 * Common Observable APIs.
 * @public
 */
const Observable = FAST.getById(2 /* observable */, () => {
	const volatileRegex = /(:|&&|\|\||if)/
	const notifierLookup = new WeakMap()
	const queueUpdate = DOM.queueUpdate
	let watcher = void 0
	let createArrayObserver = (array) => {
		throw new Error("Must call enableArrayObservation before observing arrays.")
	}
	function getNotifier(source) {
		let found = source.$fastController || notifierLookup.get(source)
		if (found === void 0) {
			if (Array.isArray(source)) {
				found = createArrayObserver(source)
			} else {
				notifierLookup.set(source, (found = new PropertyChangeNotifier(source)))
			}
		}
		return found
	}
	const getAccessors = createMetadataLocator()
	class DefaultObservableAccessor {
		constructor(name) {
			this.name = name
			this.field = `_${name}`
			this.callback = `${name}Changed`
		}
		getValue(source) {
			if (watcher !== void 0) {
				watcher.watch(source, this.name)
			}
			return source[this.field]
		}
		setValue(source, newValue) {
			const field = this.field
			const oldValue = source[field]
			if (oldValue !== newValue) {
				source[field] = newValue
				const callback = source[this.callback]
				if (typeof callback === "function") {
					callback.call(source, oldValue, newValue)
				}
				getNotifier(source).notify(this.name)
			}
		}
	}
	class BindingObserverImplementation extends SubscriberSet {
		constructor(binding, initialSubscriber, isVolatileBinding = false) {
			super(binding, initialSubscriber)
			this.binding = binding
			this.isVolatileBinding = isVolatileBinding
			this.needsRefresh = true
			this.needsQueue = true
			this.first = this
			this.last = null
			this.propertySource = void 0
			this.propertyName = void 0
			this.notifier = void 0
			this.next = void 0
		}
		observe(source, context) {
			if (this.needsRefresh && this.last !== null) {
				this.disconnect()
			}
			const previousWatcher = watcher
			watcher = this.needsRefresh ? this : void 0
			this.needsRefresh = this.isVolatileBinding
			const result = this.binding(source, context)
			watcher = previousWatcher
			return result
		}
		disconnect() {
			if (this.last !== null) {
				let current = this.first
				while (current !== void 0) {
					current.notifier.unsubscribe(this, current.propertyName)
					current = current.next
				}
				this.last = null
				this.needsRefresh = this.needsQueue = true
			}
		}
		watch(propertySource, propertyName) {
			const prev = this.last
			const notifier = getNotifier(propertySource)
			const current = prev === null ? this.first : {}
			current.propertySource = propertySource
			current.propertyName = propertyName
			current.notifier = notifier
			notifier.subscribe(this, propertyName)
			if (prev !== null) {
				if (!this.needsRefresh) {
					// Declaring the variable prior to assignment below circumvents
					// a bug in Angular's optimization process causing infinite recursion
					// of this watch() method. Details https://github.com/microsoft/fast/issues/4969
					let prevValue
					watcher = void 0
					/* eslint-disable-next-line */
					prevValue = prev.propertySource[prev.propertyName]
					/* eslint-disable-next-line @typescript-eslint/no-this-alias */
					watcher = this
					if (propertySource === prevValue) {
						this.needsRefresh = true
					}
				}
				prev.next = current
			}
			this.last = current
		}
		handleChange() {
			if (this.needsQueue) {
				this.needsQueue = false
				queueUpdate(this)
			}
		}
		call() {
			if (this.last !== null) {
				this.needsQueue = true
				this.notify(this)
			}
		}
		records() {
			let next = this.first
			return {
				next: () => {
					const current = next
					if (current === undefined) {
						return {
							value: void 0,
							done: true,
						}
					} else {
						next = next.next
						return {
							value: current,
							done: false,
						}
					}
				},
				[Symbol.iterator]: function () {
					return this
				},
			}
		}
	}
	return Object.freeze({
		/**
		 * @internal
		 * @param factory - The factory used to create array observers.
		 */
		setArrayObserverFactory(factory) {
			createArrayObserver = factory
		},
		/**
		 * Gets a notifier for an object or Array.
		 * @param source - The object or Array to get the notifier for.
		 */
		getNotifier,
		/**
		 * Records a property change for a source object.
		 * @param source - The object to record the change against.
		 * @param propertyName - The property to track as changed.
		 */
		track(source, propertyName) {
			if (watcher !== void 0) {
				watcher.watch(source, propertyName)
			}
		},
		/**
		 * Notifies watchers that the currently executing property getter or function is volatile
		 * with respect to its observable dependencies.
		 */
		trackVolatile() {
			if (watcher !== void 0) {
				watcher.needsRefresh = true
			}
		},
		/**
		 * Notifies subscribers of a source object of changes.
		 * @param source - the object to notify of changes.
		 * @param args - The change args to pass to subscribers.
		 */
		notify(source, args) {
			getNotifier(source).notify(args)
		},
		/**
		 * Defines an observable property on an object or prototype.
		 * @param target - The target object to define the observable on.
		 * @param nameOrAccessor - The name of the property to define as observable;
		 * or a custom accessor that specifies the property name and accessor implementation.
		 */
		defineProperty(target, nameOrAccessor) {
			if (typeof nameOrAccessor === "string") {
				nameOrAccessor = new DefaultObservableAccessor(nameOrAccessor)
			}
			getAccessors(target).push(nameOrAccessor)
			Reflect.defineProperty(target, nameOrAccessor.name, {
				enumerable: true,
				get: function () {
					return nameOrAccessor.getValue(this)
				},
				set: function (newValue) {
					nameOrAccessor.setValue(this, newValue)
				},
			})
		},
		/**
		 * Finds all the observable accessors defined on the target,
		 * including its prototype chain.
		 * @param target - The target object to search for accessor on.
		 */
		getAccessors,
		/**
		 * Creates a {@link BindingObserver} that can watch the
		 * provided {@link Binding} for changes.
		 * @param binding - The binding to observe.
		 * @param initialSubscriber - An initial subscriber to changes in the binding value.
		 * @param isVolatileBinding - Indicates whether the binding's dependency list must be re-evaluated on every value evaluation.
		 */
		binding(binding, initialSubscriber, isVolatileBinding = this.isVolatileBinding(binding)) {
			return new BindingObserverImplementation(binding, initialSubscriber, isVolatileBinding)
		},
		/**
		 * Determines whether a binding expression is volatile and needs to have its dependency list re-evaluated
		 * on every evaluation of the value.
		 * @param binding - The binding to inspect.
		 */
		isVolatileBinding(binding) {
			return volatileRegex.test(binding.toString())
		},
	})
})
/**
 * Decorator: Defines an observable property on the target.
 * @param target - The target to define the observable on.
 * @param nameOrAccessor - The property name or accessor to define the observable as.
 * @public
 */
function observable(target, nameOrAccessor) {
	Observable.defineProperty(target, nameOrAccessor)
}
/**
 * Decorator: Marks a property getter as having volatile observable dependencies.
 * @param target - The target that the property is defined on.
 * @param name - The property name.
 * @param name - The existing descriptor.
 * @public
 */
function volatile(target, name, descriptor) {
	return Object.assign({}, descriptor, {
		get: function () {
			Observable.trackVolatile()
			return descriptor.get.apply(this)
		},
	})
}
const contextEvent = FAST.getById(3 /* contextEvent */, () => {
	let current = null
	return {
		get() {
			return current
		},
		set(event) {
			current = event
		},
	}
})
/**
 * Provides additional contextual information available to behaviors and expressions.
 * @public
 */
class ExecutionContext {
	constructor() {
		/**
		 * The index of the current item within a repeat context.
		 */
		this.index = 0
		/**
		 * The length of the current collection within a repeat context.
		 */
		this.length = 0
		/**
		 * The parent data object within a repeat context.
		 */
		this.parent = null
		/**
		 * The parent execution context when in nested context scenarios.
		 */
		this.parentContext = null
	}
	/**
	 * The current event within an event handler.
	 */
	get event() {
		return contextEvent.get()
	}
	/**
	 * Indicates whether the current item within a repeat context
	 * has an even index.
	 */
	get isEven() {
		return this.index % 2 === 0
	}
	/**
	 * Indicates whether the current item within a repeat context
	 * has an odd index.
	 */
	get isOdd() {
		return this.index % 2 !== 0
	}
	/**
	 * Indicates whether the current item within a repeat context
	 * is the first item in the collection.
	 */
	get isFirst() {
		return this.index === 0
	}
	/**
	 * Indicates whether the current item within a repeat context
	 * is somewhere in the middle of the collection.
	 */
	get isInMiddle() {
		return !this.isFirst && !this.isLast
	}
	/**
	 * Indicates whether the current item within a repeat context
	 * is the last item in the collection.
	 */
	get isLast() {
		return this.index === this.length - 1
	}
	/**
	 * Sets the event for the current execution context.
	 * @param event - The event to set.
	 * @internal
	 */
	static setEvent(event) {
		contextEvent.set(event)
	}
}
Observable.defineProperty(ExecutionContext.prototype, "index")
Observable.defineProperty(ExecutionContext.prototype, "length")
/**
 * The default execution context used in binding expressions.
 * @public
 */
const defaultExecutionContext = Object.seal(new ExecutionContext())

/**
 * Instructs the template engine to apply behavior to a node.
 * @public
 */
class HTMLDirective {
	constructor() {
		/**
		 * The index of the DOM node to which the created behavior will apply.
		 */
		this.targetIndex = 0
	}
}
/**
 * A {@link HTMLDirective} that targets a named attribute or property on a node.
 * @public
 */
class TargetedHTMLDirective extends HTMLDirective {
	constructor() {
		super(...arguments)
		/**
		 * Creates a placeholder string based on the directive's index within the template.
		 * @param index - The index of the directive within the template.
		 */
		this.createPlaceholder = DOM.createInterpolationPlaceholder
	}
}
/**
 * A directive that attaches special behavior to an element via a custom attribute.
 * @public
 */
class AttachedBehaviorHTMLDirective extends HTMLDirective {
	/**
	 *
	 * @param name - The name of the behavior; used as a custom attribute on the element.
	 * @param behavior - The behavior to instantiate and attach to the element.
	 * @param options - Options to pass to the behavior during creation.
	 */
	constructor(name, behavior, options) {
		super()
		this.name = name
		this.behavior = behavior
		this.options = options
	}
	/**
	 * Creates a placeholder string based on the directive's index within the template.
	 * @param index - The index of the directive within the template.
	 * @remarks
	 * Creates a custom attribute placeholder.
	 */
	createPlaceholder(index) {
		return DOM.createCustomAttributePlaceholder(this.name, index)
	}
	/**
	 * Creates a behavior for the provided target node.
	 * @param target - The node instance to create the behavior for.
	 * @remarks
	 * Creates an instance of the `behavior` type this directive was constructed with
	 * and passes the target and options to that `behavior`'s constructor.
	 */
	createBehavior(target) {
		return new this.behavior(target, this.options)
	}
}

function normalBind(source, context) {
	this.source = source
	this.context = context
	if (this.bindingObserver === null) {
		this.bindingObserver = Observable.binding(this.binding, this, this.isBindingVolatile)
	}
	this.updateTarget(this.bindingObserver.observe(source, context))
}
function triggerBind(source, context) {
	this.source = source
	this.context = context
	this.target.addEventListener(this.targetName, this)
}
function normalUnbind() {
	this.bindingObserver.disconnect()
	this.source = null
	this.context = null
}
function contentUnbind() {
	this.bindingObserver.disconnect()
	this.source = null
	this.context = null
	const view = this.target.$fastView
	if (view !== void 0 && view.isComposed) {
		view.unbind()
		view.needsBindOnly = true
	}
}
function triggerUnbind() {
	this.target.removeEventListener(this.targetName, this)
	this.source = null
	this.context = null
}
function updateAttributeTarget(value) {
	DOM.setAttribute(this.target, this.targetName, value)
}
function updateBooleanAttributeTarget(value) {
	DOM.setBooleanAttribute(this.target, this.targetName, value)
}
function updateContentTarget(value) {
	// If there's no actual value, then this equates to the
	// empty string for the purposes of content bindings.
	if (value === null || value === undefined) {
		value = ""
	}
	// If the value has a "create" method, then it's a template-like.
	if (value.create) {
		this.target.textContent = ""
		let view = this.target.$fastView
		// If there's no previous view that we might be able to
		// reuse then create a new view from the template.
		if (view === void 0) {
			view = value.create()
		} else {
			// If there is a previous view, but it wasn't created
			// from the same template as the new value, then we
			// need to remove the old view if it's still in the DOM
			// and create a new view from the template.
			if (this.target.$fastTemplate !== value) {
				if (view.isComposed) {
					view.remove()
					view.unbind()
				}
				view = value.create()
			}
		}
		// It's possible that the value is the same as the previous template
		// and that there's actually no need to compose it.
		if (!view.isComposed) {
			view.isComposed = true
			view.bind(this.source, this.context)
			view.insertBefore(this.target)
			this.target.$fastView = view
			this.target.$fastTemplate = value
		} else if (view.needsBindOnly) {
			view.needsBindOnly = false
			view.bind(this.source, this.context)
		}
	} else {
		const view = this.target.$fastView
		// If there is a view and it's currently composed into
		// the DOM, then we need to remove it.
		if (view !== void 0 && view.isComposed) {
			view.isComposed = false
			view.remove()
			if (view.needsBindOnly) {
				view.needsBindOnly = false
			} else {
				view.unbind()
			}
		}
		this.target.textContent = value
	}
}
function updatePropertyTarget(value) {
	this.target[this.targetName] = value
}
function updateClassTarget(value) {
	const classVersions = this.classVersions || Object.create(null)
	const target = this.target
	let version = this.version || 0
	// Add the classes, tracking the version at which they were added.
	if (value !== null && value !== undefined && value.length) {
		const names = value.split(/\s+/)
		for (let i = 0, ii = names.length; i < ii; ++i) {
			const currentName = names[i]
			if (currentName === "") {
				continue
			}
			classVersions[currentName] = version
			target.classList.add(currentName)
		}
	}
	this.classVersions = classVersions
	this.version = version + 1
	// If this is the first call to add classes, there's no need to remove old ones.
	if (version === 0) {
		return
	}
	// Remove classes from the previous version.
	version -= 1
	for (const name in classVersions) {
		if (classVersions[name] === version) {
			target.classList.remove(name)
		}
	}
}
/**
 * A directive that configures data binding to element content and attributes.
 * @public
 */
class HTMLBindingDirective extends TargetedHTMLDirective {
	/**
	 * Creates an instance of BindingDirective.
	 * @param binding - A binding that returns the data used to update the DOM.
	 */
	constructor(binding) {
		super()
		this.binding = binding
		this.bind = normalBind
		this.unbind = normalUnbind
		this.updateTarget = updateAttributeTarget
		this.isBindingVolatile = Observable.isVolatileBinding(this.binding)
	}
	/**
	 * Gets/sets the name of the attribute or property that this
	 * binding is targeting.
	 */
	get targetName() {
		return this.originalTargetName
	}
	set targetName(value) {
		this.originalTargetName = value
		if (value === void 0) {
			return
		}
		switch (value[0]) {
			case ":":
				this.cleanedTargetName = value.substr(1)
				this.updateTarget = updatePropertyTarget
				if (this.cleanedTargetName === "innerHTML") {
					const binding = this.binding
					this.binding = (s, c) => DOM.createHTML(binding(s, c))
				}
				break
			case "?":
				this.cleanedTargetName = value.substr(1)
				this.updateTarget = updateBooleanAttributeTarget
				break
			case "@":
				this.cleanedTargetName = value.substr(1)
				this.bind = triggerBind
				this.unbind = triggerUnbind
				break
			default:
				this.cleanedTargetName = value
				if (value === "class") {
					this.updateTarget = updateClassTarget
				}
				break
		}
	}
	/**
	 * Makes this binding target the content of an element rather than
	 * a particular attribute or property.
	 */
	targetAtContent() {
		this.updateTarget = updateContentTarget
		this.unbind = contentUnbind
	}
	/**
	 * Creates the runtime BindingBehavior instance based on the configuration
	 * information stored in the BindingDirective.
	 * @param target - The target node that the binding behavior should attach to.
	 */
	createBehavior(target) {
		/* eslint-disable-next-line @typescript-eslint/no-use-before-define */
		return new BindingBehavior(
			target,
			this.binding,
			this.isBindingVolatile,
			this.bind,
			this.unbind,
			this.updateTarget,
			this.cleanedTargetName,
		)
	}
}
/**
 * A behavior that updates content and attributes based on a configured
 * BindingDirective.
 * @public
 */
class BindingBehavior {
	/**
	 * Creates an instance of BindingBehavior.
	 * @param target - The target of the data updates.
	 * @param binding - The binding that returns the latest value for an update.
	 * @param isBindingVolatile - Indicates whether the binding has volatile dependencies.
	 * @param bind - The operation to perform during binding.
	 * @param unbind - The operation to perform during unbinding.
	 * @param updateTarget - The operation to perform when updating.
	 * @param targetName - The name of the target attribute or property to update.
	 */
	constructor(target, binding, isBindingVolatile, bind, unbind, updateTarget, targetName) {
		/** @internal */
		this.source = null
		/** @internal */
		this.context = null
		/** @internal */
		this.bindingObserver = null
		this.target = target
		this.binding = binding
		this.isBindingVolatile = isBindingVolatile
		this.bind = bind
		this.unbind = unbind
		this.updateTarget = updateTarget
		this.targetName = targetName
	}
	/** @internal */
	handleChange() {
		this.updateTarget(this.bindingObserver.observe(this.source, this.context))
	}
	/** @internal */
	handleEvent(event) {
		ExecutionContext.setEvent(event)
		const result = this.binding(this.source, this.context)
		ExecutionContext.setEvent(null)
		if (result !== true) {
			event.preventDefault()
		}
	}
}

let sharedContext = null
class CompilationContext {
	addFactory(factory) {
		factory.targetIndex = this.targetIndex
		this.behaviorFactories.push(factory)
	}
	captureContentBinding(directive) {
		directive.targetAtContent()
		this.addFactory(directive)
	}
	reset() {
		this.behaviorFactories = []
		this.targetIndex = -1
	}
	release() {
		/* eslint-disable-next-line @typescript-eslint/no-this-alias */
		sharedContext = this
	}
	static borrow(directives) {
		const shareable = sharedContext || new CompilationContext()
		shareable.directives = directives
		shareable.reset()
		sharedContext = null
		return shareable
	}
}
function createAggregateBinding(parts) {
	if (parts.length === 1) {
		return parts[0]
	}
	let targetName
	const partCount = parts.length
	const finalParts = parts.map((x) => {
		if (typeof x === "string") {
			return () => x
		}
		targetName = x.targetName || targetName
		return x.binding
	})
	const binding = (scope, context) => {
		let output = ""
		for (let i = 0; i < partCount; ++i) {
			output += finalParts[i](scope, context)
		}
		return output
	}
	const directive = new HTMLBindingDirective(binding)
	directive.targetName = targetName
	return directive
}
const interpolationEndLength = _interpolationEnd.length
function parseContent(context, value) {
	const valueParts = value.split(_interpolationStart)
	if (valueParts.length === 1) {
		return null
	}
	const bindingParts = []
	for (let i = 0, ii = valueParts.length; i < ii; ++i) {
		const current = valueParts[i]
		const index = current.indexOf(_interpolationEnd)
		let literal
		if (index === -1) {
			literal = current
		} else {
			const directiveIndex = parseInt(current.substring(0, index))
			bindingParts.push(context.directives[directiveIndex])
			literal = current.substring(index + interpolationEndLength)
		}
		if (literal !== "") {
			bindingParts.push(literal)
		}
	}
	return bindingParts
}
function compileAttributes(context, node, includeBasicValues = false) {
	const attributes = node.attributes
	for (let i = 0, ii = attributes.length; i < ii; ++i) {
		const attr = attributes[i]
		const attrValue = attr.value
		const parseResult = parseContent(context, attrValue)
		let result = null
		if (parseResult === null) {
			if (includeBasicValues) {
				result = new HTMLBindingDirective(() => attrValue)
				result.targetName = attr.name
			}
		} else {
			result = createAggregateBinding(parseResult)
		}
		if (result !== null) {
			node.removeAttributeNode(attr)
			i--
			ii--
			context.addFactory(result)
		}
	}
}
function compileContent(context, node, walker) {
	const parseResult = parseContent(context, node.textContent)
	if (parseResult !== null) {
		let lastNode = node
		for (let i = 0, ii = parseResult.length; i < ii; ++i) {
			const currentPart = parseResult[i]
			const currentNode =
				i === 0 ? node : lastNode.parentNode.insertBefore(document.createTextNode(""), lastNode.nextSibling)
			if (typeof currentPart === "string") {
				currentNode.textContent = currentPart
			} else {
				currentNode.textContent = " "
				context.captureContentBinding(currentPart)
			}
			lastNode = currentNode
			context.targetIndex++
			if (currentNode !== node) {
				walker.nextNode()
			}
		}
		context.targetIndex--
	}
}
/**
 * Compiles a template and associated directives into a raw compilation
 * result which include a cloneable DocumentFragment and factories capable
 * of attaching runtime behavior to nodes within the fragment.
 * @param template - The template to compile.
 * @param directives - The directives referenced by the template.
 * @remarks
 * The template that is provided for compilation is altered in-place
 * and cannot be compiled again. If the original template must be preserved,
 * it is recommended that you clone the original and pass the clone to this API.
 * @public
 */
function compileTemplate(template, directives) {
	const fragment = template.content
	// https://bugs.chromium.org/p/chromium/issues/detail?id=1111864
	document.adoptNode(fragment)
	const context = CompilationContext.borrow(directives)
	compileAttributes(context, template, true)
	const hostBehaviorFactories = context.behaviorFactories
	context.reset()
	const walker = DOM.createTemplateWalker(fragment)
	let node
	while ((node = walker.nextNode())) {
		context.targetIndex++
		switch (node.nodeType) {
			case 1:
				// element node
				compileAttributes(context, node)
				break
			case 3:
				// text node
				compileContent(context, node, walker)
				break
			case 8:
				// comment
				if (DOM.isMarker(node)) {
					context.addFactory(directives[DOM.extractDirectiveIndexFromMarker(node)])
				}
		}
	}
	let targetOffset = 0
	if (
		// If the first node in a fragment is a marker, that means it's an unstable first node,
		// because something like a when, repeat, etc. could add nodes before the marker.
		// To mitigate this, we insert a stable first node. However, if we insert a node,
		// that will alter the result of the TreeWalker. So, we also need to offset the target index.
		DOM.isMarker(fragment.firstChild) ||
		// Or if there is only one node and a directive, it means the template's content
		// is *only* the directive. In that case, HTMLView.dispose() misses any nodes inserted by
		// the directive. Inserting a new node ensures proper disposal of nodes added by the directive.
		(fragment.childNodes.length === 1 && directives.length)
	) {
		fragment.insertBefore(document.createComment(""), fragment.firstChild)
		targetOffset = -1
	}
	const viewBehaviorFactories = context.behaviorFactories
	context.release()
	return {
		fragment,
		viewBehaviorFactories,
		hostBehaviorFactories,
		targetOffset,
	}
}

// A singleton Range instance used to efficiently remove ranges of DOM nodes.
// See the implementation of HTMLView below for further details.
const range = document.createRange()
/**
 * The standard View implementation, which also implements ElementView and SyntheticView.
 * @public
 */
class HTMLView {
	/**
	 * Constructs an instance of HTMLView.
	 * @param fragment - The html fragment that contains the nodes for this view.
	 * @param behaviors - The behaviors to be applied to this view.
	 */
	constructor(fragment, behaviors) {
		this.fragment = fragment
		this.behaviors = behaviors
		/**
		 * The data that the view is bound to.
		 */
		this.source = null
		/**
		 * The execution context the view is running within.
		 */
		this.context = null
		this.firstChild = fragment.firstChild
		this.lastChild = fragment.lastChild
	}
	/**
	 * Appends the view's DOM nodes to the referenced node.
	 * @param node - The parent node to append the view's DOM nodes to.
	 */
	appendTo(node) {
		node.appendChild(this.fragment)
	}
	/**
	 * Inserts the view's DOM nodes before the referenced node.
	 * @param node - The node to insert the view's DOM before.
	 */
	insertBefore(node) {
		if (this.fragment.hasChildNodes()) {
			node.parentNode.insertBefore(this.fragment, node)
		} else {
			const end = this.lastChild
			if (node.previousSibling === end) return
			const parentNode = node.parentNode
			let current = this.firstChild
			let next
			while (current !== end) {
				next = current.nextSibling
				parentNode.insertBefore(current, node)
				current = next
			}
			parentNode.insertBefore(end, node)
		}
	}
	/**
	 * Removes the view's DOM nodes.
	 * The nodes are not disposed and the view can later be re-inserted.
	 */
	remove() {
		const fragment = this.fragment
		const end = this.lastChild
		let current = this.firstChild
		let next
		while (current !== end) {
			next = current.nextSibling
			fragment.appendChild(current)
			current = next
		}
		fragment.appendChild(end)
	}
	/**
	 * Removes the view and unbinds its behaviors, disposing of DOM nodes afterward.
	 * Once a view has been disposed, it cannot be inserted or bound again.
	 */
	dispose() {
		const parent = this.firstChild.parentNode
		const end = this.lastChild
		let current = this.firstChild
		let next
		while (current !== end) {
			next = current.nextSibling
			parent.removeChild(current)
			current = next
		}
		parent.removeChild(end)
		const behaviors = this.behaviors
		const oldSource = this.source
		for (let i = 0, ii = behaviors.length; i < ii; ++i) {
			behaviors[i].unbind(oldSource)
		}
	}
	/**
	 * Binds a view's behaviors to its binding source.
	 * @param source - The binding source for the view's binding behaviors.
	 * @param context - The execution context to run the behaviors within.
	 */
	bind(source, context) {
		const behaviors = this.behaviors
		if (this.source === source) {
			return
		} else if (this.source !== null) {
			const oldSource = this.source
			this.source = source
			this.context = context
			for (let i = 0, ii = behaviors.length; i < ii; ++i) {
				const current = behaviors[i]
				current.unbind(oldSource)
				current.bind(source, context)
			}
		} else {
			this.source = source
			this.context = context
			for (let i = 0, ii = behaviors.length; i < ii; ++i) {
				behaviors[i].bind(source, context)
			}
		}
	}
	/**
	 * Unbinds a view's behaviors from its binding source.
	 */
	unbind() {
		if (this.source === null) {
			return
		}
		const behaviors = this.behaviors
		const oldSource = this.source
		for (let i = 0, ii = behaviors.length; i < ii; ++i) {
			behaviors[i].unbind(oldSource)
		}
		this.source = null
	}
	/**
	 * Efficiently disposes of a contiguous range of synthetic view instances.
	 * @param views - A contiguous range of views to be disposed.
	 */
	static disposeContiguousBatch(views) {
		if (views.length === 0) {
			return
		}
		range.setStartBefore(views[0].firstChild)
		range.setEndAfter(views[views.length - 1].lastChild)
		range.deleteContents()
		for (let i = 0, ii = views.length; i < ii; ++i) {
			const view = views[i]
			const behaviors = view.behaviors
			const oldSource = view.source
			for (let j = 0, jj = behaviors.length; j < jj; ++j) {
				behaviors[j].unbind(oldSource)
			}
		}
	}
}

/**
 * A template capable of creating HTMLView instances or rendering directly to DOM.
 * @public
 */
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
class ViewTemplate {
	/**
	 * Creates an instance of ViewTemplate.
	 * @param html - The html representing what this template will instantiate, including placeholders for directives.
	 * @param directives - The directives that will be connected to placeholders in the html.
	 */
	constructor(html, directives) {
		this.behaviorCount = 0
		this.hasHostBehaviors = false
		this.fragment = null
		this.targetOffset = 0
		this.viewBehaviorFactories = null
		this.hostBehaviorFactories = null
		this.html = html
		this.directives = directives
	}
	/**
	 * Creates an HTMLView instance based on this template definition.
	 * @param hostBindingTarget - The element that host behaviors will be bound to.
	 */
	create(hostBindingTarget) {
		if (this.fragment === null) {
			let template
			const html = this.html
			if (typeof html === "string") {
				template = document.createElement("template")
				template.innerHTML = DOM.createHTML(html)
				const fec = template.content.firstElementChild
				if (fec !== null && fec.tagName === "TEMPLATE") {
					template = fec
				}
			} else {
				template = html
			}
			const result = compileTemplate(template, this.directives)
			this.fragment = result.fragment
			this.viewBehaviorFactories = result.viewBehaviorFactories
			this.hostBehaviorFactories = result.hostBehaviorFactories
			this.targetOffset = result.targetOffset
			this.behaviorCount = this.viewBehaviorFactories.length + this.hostBehaviorFactories.length
			this.hasHostBehaviors = this.hostBehaviorFactories.length > 0
		}
		const fragment = this.fragment.cloneNode(true)
		const viewFactories = this.viewBehaviorFactories
		const behaviors = new Array(this.behaviorCount)
		const walker = DOM.createTemplateWalker(fragment)
		let behaviorIndex = 0
		let targetIndex = this.targetOffset
		let node = walker.nextNode()
		for (let ii = viewFactories.length; behaviorIndex < ii; ++behaviorIndex) {
			const factory = viewFactories[behaviorIndex]
			const factoryIndex = factory.targetIndex
			while (node !== null) {
				if (targetIndex === factoryIndex) {
					behaviors[behaviorIndex] = factory.createBehavior(node)
					break
				} else {
					node = walker.nextNode()
					targetIndex++
				}
			}
		}
		if (this.hasHostBehaviors) {
			const hostFactories = this.hostBehaviorFactories
			for (let i = 0, ii = hostFactories.length; i < ii; ++i, ++behaviorIndex) {
				behaviors[behaviorIndex] = hostFactories[i].createBehavior(hostBindingTarget)
			}
		}
		return new HTMLView(fragment, behaviors)
	}
	/**
	 * Creates an HTMLView from this template, binds it to the source, and then appends it to the host.
	 * @param source - The data source to bind the template to.
	 * @param host - The Element where the template will be rendered.
	 * @param hostBindingTarget - An HTML element to target the host bindings at if different from the
	 * host that the template is being attached to.
	 */
	render(source, host, hostBindingTarget) {
		if (typeof host === "string") {
			host = document.getElementById(host)
		}
		if (hostBindingTarget === void 0) {
			hostBindingTarget = host
		}
		const view = this.create(hostBindingTarget)
		view.bind(source, defaultExecutionContext)
		view.appendTo(host)
		return view
	}
}
// Much thanks to LitHTML for working this out!
const lastAttributeNameRegex =
	/* eslint-disable-next-line no-control-regex */
	/([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/
/**
 * Transforms a template literal string into a renderable ViewTemplate.
 * @param strings - The string fragments that are interpolated with the values.
 * @param values - The values that are interpolated with the string fragments.
 * @remarks
 * The html helper supports interpolation of strings, numbers, binding expressions,
 * other template instances, and Directive instances.
 * @public
 */
function html(strings, ...values) {
	const directives = []
	let html = ""
	for (let i = 0, ii = strings.length - 1; i < ii; ++i) {
		const currentString = strings[i]
		let value = values[i]
		html += currentString
		if (value instanceof ViewTemplate) {
			const template = value
			value = () => template
		}
		if (typeof value === "function") {
			value = new HTMLBindingDirective(value)
		}
		if (value instanceof TargetedHTMLDirective) {
			const match = lastAttributeNameRegex.exec(currentString)
			if (match !== null) {
				value.targetName = match[2]
			}
		}
		if (value instanceof HTMLDirective) {
			// Since not all values are directives, we can't use i
			// as the index for the placeholder. Instead, we need to
			// use directives.length to get the next index.
			html += value.createPlaceholder(directives.length)
			directives.push(value)
		} else {
			html += value
		}
	}
	html += strings[strings.length - 1]
	return new ViewTemplate(html, directives)
}

/**
 * Represents styles that can be applied to a custom element.
 * @public
 */
class ElementStyles {
	constructor() {
		this.targets = new WeakSet()
	}
	/** @internal */
	addStylesTo(target) {
		this.targets.add(target)
	}
	/** @internal */
	removeStylesFrom(target) {
		this.targets.delete(target)
	}
	/** @internal */
	isAttachedTo(target) {
		return this.targets.has(target)
	}
	/**
	 * Associates behaviors with this set of styles.
	 * @param behaviors - The behaviors to associate.
	 */
	withBehaviors(...behaviors) {
		this.behaviors = this.behaviors === null ? behaviors : this.behaviors.concat(behaviors)
		return this
	}
}
/**
 * Create ElementStyles from ComposableStyles.
 */
ElementStyles.create = (() => {
	if (DOM.supportsAdoptedStyleSheets) {
		const styleSheetCache = new Map()
		return (styles) =>
			// eslint-disable-next-line @typescript-eslint/no-use-before-define
			new AdoptedStyleSheetsStyles(styles, styleSheetCache)
	}
	// eslint-disable-next-line @typescript-eslint/no-use-before-define
	return (styles) => new StyleElementStyles(styles)
})()
function reduceStyles(styles) {
	return styles
		.map((x) => (x instanceof ElementStyles ? reduceStyles(x.styles) : [x]))
		.reduce((prev, curr) => prev.concat(curr), [])
}
function reduceBehaviors(styles) {
	return styles
		.map((x) => (x instanceof ElementStyles ? x.behaviors : null))
		.reduce((prev, curr) => {
			if (curr === null) {
				return prev
			}
			if (prev === null) {
				prev = []
			}
			return prev.concat(curr)
		}, null)
}
let addAdoptedStyleSheets = (target, sheets) => {
	target.adoptedStyleSheets = [...target.adoptedStyleSheets, ...sheets]
}
let removeAdoptedStyleSheets = (target, sheets) => {
	target.adoptedStyleSheets = target.adoptedStyleSheets.filter((x) => sheets.indexOf(x) === -1)
}
if (DOM.supportsAdoptedStyleSheets) {
	try {
		// Test if browser implementation uses FrozenArray.
		// If not, use push / splice to alter the stylesheets
		// in place. This circumvents a bug in Safari 16.4 where
		// periodically, assigning the array would previously
		// cause sheets to be removed.
		document.adoptedStyleSheets.push()
		document.adoptedStyleSheets.splice()
		addAdoptedStyleSheets = (target, sheets) => {
			target.adoptedStyleSheets.push(...sheets)
		}
		removeAdoptedStyleSheets = (target, sheets) => {
			for (const sheet of sheets) {
				const index = target.adoptedStyleSheets.indexOf(sheet)
				if (index !== -1) {
					target.adoptedStyleSheets.splice(index, 1)
				}
			}
		}
	} catch (e) {
		// Do nothing if an error is thrown, the default
		// case handles FrozenArray.
	}
}
/**
 * https://wicg.github.io/construct-stylesheets/
 * https://developers.google.com/web/updates/2019/02/constructable-stylesheets
 *
 * @internal
 */
class AdoptedStyleSheetsStyles extends ElementStyles {
	constructor(styles, styleSheetCache) {
		super()
		this.styles = styles
		this.styleSheetCache = styleSheetCache
		this._styleSheets = void 0
		this.behaviors = reduceBehaviors(styles)
	}
	get styleSheets() {
		if (this._styleSheets === void 0) {
			const styles = this.styles
			const styleSheetCache = this.styleSheetCache
			this._styleSheets = reduceStyles(styles).map((x) => {
				if (x instanceof CSSStyleSheet) {
					return x
				}
				let sheet = styleSheetCache.get(x)
				if (sheet === void 0) {
					sheet = new CSSStyleSheet()
					sheet.replaceSync(x)
					styleSheetCache.set(x, sheet)
				}
				return sheet
			})
		}
		return this._styleSheets
	}
	addStylesTo(target) {
		addAdoptedStyleSheets(target, this.styleSheets)
		super.addStylesTo(target)
	}
	removeStylesFrom(target) {
		removeAdoptedStyleSheets(target, this.styleSheets)
		super.removeStylesFrom(target)
	}
}
let styleClassId = 0
function getNextStyleClass() {
	return `fast-style-class-${++styleClassId}`
}
/**
 * @internal
 */
class StyleElementStyles extends ElementStyles {
	constructor(styles) {
		super()
		this.styles = styles
		this.behaviors = null
		this.behaviors = reduceBehaviors(styles)
		this.styleSheets = reduceStyles(styles)
		this.styleClass = getNextStyleClass()
	}
	addStylesTo(target) {
		const styleSheets = this.styleSheets
		const styleClass = this.styleClass
		target = this.normalizeTarget(target)
		for (let i = 0; i < styleSheets.length; i++) {
			const element = document.createElement("style")
			element.innerHTML = styleSheets[i]
			element.className = styleClass
			target.append(element)
		}
		super.addStylesTo(target)
	}
	removeStylesFrom(target) {
		target = this.normalizeTarget(target)
		const styles = target.querySelectorAll(`.${this.styleClass}`)
		for (let i = 0, ii = styles.length; i < ii; ++i) {
			target.removeChild(styles[i])
		}
		super.removeStylesFrom(target)
	}
	isAttachedTo(target) {
		return super.isAttachedTo(this.normalizeTarget(target))
	}
	normalizeTarget(target) {
		return target === document ? document.body : target
	}
}

/**
 * Metadata used to configure a custom attribute's behavior.
 * @public
 */
const AttributeConfiguration = Object.freeze({
	/**
	 * Locates all attribute configurations associated with a type.
	 */
	locate: createMetadataLocator(),
})
/**
 * A {@link ValueConverter} that converts to and from `boolean` values.
 * @remarks
 * Used automatically when the `boolean` {@link AttributeMode} is selected.
 * @public
 */
const booleanConverter = {
	toView(value) {
		return value ? "true" : "false"
	},
	fromView(value) {
		if (value === null || value === void 0 || value === "false" || value === false || value === 0) {
			return false
		}
		return true
	},
}
/**
 * A {@link ValueConverter} that converts to and from `number` values.
 * @remarks
 * This converter allows for nullable numbers, returning `null` if the
 * input was `null`, `undefined`, or `NaN`.
 * @public
 */
const nullableNumberConverter = {
	toView(value) {
		if (value === null || value === undefined) {
			return null
		}
		const number = value * 1
		return isNaN(number) ? null : number.toString()
	},
	fromView(value) {
		if (value === null || value === undefined) {
			return null
		}
		const number = value * 1
		return isNaN(number) ? null : number
	},
}
/**
 * An implementation of {@link Accessor} that supports reactivity,
 * change callbacks, attribute reflection, and type conversion for
 * custom elements.
 * @public
 */
class AttributeDefinition {
	/**
	 * Creates an instance of AttributeDefinition.
	 * @param Owner - The class constructor that owns this attribute.
	 * @param name - The name of the property associated with the attribute.
	 * @param attribute - The name of the attribute in HTML.
	 * @param mode - The {@link AttributeMode} that describes the behavior of this attribute.
	 * @param converter - A {@link ValueConverter} that integrates with the property getter/setter
	 * to convert values to and from a DOM string.
	 */
	constructor(Owner, name, attribute = name.toLowerCase(), mode = "reflect", converter) {
		this.guards = new Set()
		this.Owner = Owner
		this.name = name
		this.attribute = attribute
		this.mode = mode
		this.converter = converter
		this.fieldName = `_${name}`
		this.callbackName = `${name}Changed`
		this.hasCallback = this.callbackName in Owner.prototype
		if (mode === "boolean" && converter === void 0) {
			this.converter = booleanConverter
		}
	}
	/**
	 * Sets the value of the attribute/property on the source element.
	 * @param source - The source element to access.
	 * @param value - The value to set the attribute/property to.
	 */
	setValue(source, newValue) {
		const oldValue = source[this.fieldName]
		const converter = this.converter
		if (converter !== void 0) {
			newValue = converter.fromView(newValue)
		}
		if (oldValue !== newValue) {
			source[this.fieldName] = newValue
			this.tryReflectToAttribute(source)
			if (this.hasCallback) {
				source[this.callbackName](oldValue, newValue)
			}
			source.$fastController.notify(this.name)
		}
	}
	/**
	 * Gets the value of the attribute/property on the source element.
	 * @param source - The source element to access.
	 */
	getValue(source) {
		Observable.track(source, this.name)
		return source[this.fieldName]
	}
	/** @internal */
	onAttributeChangedCallback(element, value) {
		if (this.guards.has(element)) {
			return
		}
		this.guards.add(element)
		this.setValue(element, value)
		this.guards.delete(element)
	}
	tryReflectToAttribute(element) {
		const mode = this.mode
		const guards = this.guards
		if (guards.has(element) || mode === "fromView") {
			return
		}
		DOM.queueUpdate(() => {
			guards.add(element)
			const latestValue = element[this.fieldName]
			switch (mode) {
				case "reflect":
					const converter = this.converter
					DOM.setAttribute(element, this.attribute, converter !== void 0 ? converter.toView(latestValue) : latestValue)
					break
				case "boolean":
					DOM.setBooleanAttribute(element, this.attribute, latestValue)
					break
			}
			guards.delete(element)
		})
	}
	/**
	 * Collects all attribute definitions associated with the owner.
	 * @param Owner - The class constructor to collect attribute for.
	 * @param attributeLists - Any existing attributes to collect and merge with those associated with the owner.
	 * @internal
	 */
	static collect(Owner, ...attributeLists) {
		const attributes = []
		attributeLists.push(AttributeConfiguration.locate(Owner))
		for (let i = 0, ii = attributeLists.length; i < ii; ++i) {
			const list = attributeLists[i]
			if (list === void 0) {
				continue
			}
			for (let j = 0, jj = list.length; j < jj; ++j) {
				const config = list[j]
				if (typeof config === "string") {
					attributes.push(new AttributeDefinition(Owner, config))
				} else {
					attributes.push(
						new AttributeDefinition(Owner, config.property, config.attribute, config.mode, config.converter),
					)
				}
			}
		}
		return attributes
	}
}
function attr(configOrTarget, prop) {
	let config
	function decorator($target, $prop) {
		if (arguments.length > 1) {
			// Non invocation:
			// - @attr
			// Invocation with or w/o opts:
			// - @attr()
			// - @attr({...opts})
			config.property = $prop
		}
		AttributeConfiguration.locate($target.constructor).push(config)
	}
	if (arguments.length > 1) {
		// Non invocation:
		// - @attr
		config = {}
		decorator(configOrTarget, prop)
		return
	}
	// Invocation with or w/o opts:
	// - @attr()
	// - @attr({...opts})
	config = configOrTarget === void 0 ? {} : configOrTarget
	return decorator
}

const defaultShadowOptions = {
	mode: "open",
}
const defaultElementOptions = {}
const fastRegistry = FAST.getById(4 /* elementRegistry */, () => {
	const typeToDefinition = new Map()
	return Object.freeze({
		register(definition) {
			if (typeToDefinition.has(definition.type)) {
				return false
			}
			typeToDefinition.set(definition.type, definition)
			return true
		},
		getByType(key) {
			return typeToDefinition.get(key)
		},
	})
})
/**
 * Defines metadata for a FASTElement.
 * @public
 */
class FASTElementDefinition {
	/**
	 * Creates an instance of FASTElementDefinition.
	 * @param type - The type this definition is being created for.
	 * @param nameOrConfig - The name of the element to define or a config object
	 * that describes the element to define.
	 */
	constructor(type, nameOrConfig = type.definition) {
		if (typeof nameOrConfig === "string") {
			nameOrConfig = {
				name: nameOrConfig,
			}
		}
		this.type = type
		this.name = nameOrConfig.name
		this.template = nameOrConfig.template
		const attributes = AttributeDefinition.collect(type, nameOrConfig.attributes)
		const observedAttributes = new Array(attributes.length)
		const propertyLookup = {}
		const attributeLookup = {}
		for (let i = 0, ii = attributes.length; i < ii; ++i) {
			const current = attributes[i]
			observedAttributes[i] = current.attribute
			propertyLookup[current.name] = current
			attributeLookup[current.attribute] = current
		}
		this.attributes = attributes
		this.observedAttributes = observedAttributes
		this.propertyLookup = propertyLookup
		this.attributeLookup = attributeLookup
		this.shadowOptions =
			nameOrConfig.shadowOptions === void 0
				? defaultShadowOptions
				: nameOrConfig.shadowOptions === null
					? void 0
					: Object.assign(Object.assign({}, defaultShadowOptions), nameOrConfig.shadowOptions)
		this.elementOptions =
			nameOrConfig.elementOptions === void 0
				? defaultElementOptions
				: Object.assign(Object.assign({}, defaultElementOptions), nameOrConfig.elementOptions)
		this.styles =
			nameOrConfig.styles === void 0
				? void 0
				: Array.isArray(nameOrConfig.styles)
					? ElementStyles.create(nameOrConfig.styles)
					: nameOrConfig.styles instanceof ElementStyles
						? nameOrConfig.styles
						: ElementStyles.create([nameOrConfig.styles])
	}
	/**
	 * Indicates if this element has been defined in at least one registry.
	 */
	get isDefined() {
		return !!fastRegistry.getByType(this.type)
	}
	/**
	 * Defines a custom element based on this definition.
	 * @param registry - The element registry to define the element in.
	 */
	define(registry = customElements) {
		const type = this.type
		if (fastRegistry.register(this)) {
			const attributes = this.attributes
			const proto = type.prototype
			for (let i = 0, ii = attributes.length; i < ii; ++i) {
				Observable.defineProperty(proto, attributes[i])
			}
			Reflect.defineProperty(type, "observedAttributes", {
				value: this.observedAttributes,
				enumerable: true,
			})
		}
		if (!registry.get(this.name)) {
			registry.define(this.name, type, this.elementOptions)
		}
		return this
	}
}
/**
 * Gets the element definition associated with the specified type.
 * @param type - The custom element type to retrieve the definition for.
 */
FASTElementDefinition.forType = fastRegistry.getByType

const shadowRoots = new WeakMap()
const defaultEventOptions = {
	bubbles: true,
	composed: true,
	cancelable: true,
}
function getShadowRoot(element) {
	return element.shadowRoot || shadowRoots.get(element) || null
}
/**
 * Controls the lifecycle and rendering of a `FASTElement`.
 * @public
 */
class Controller extends PropertyChangeNotifier {
	/**
	 * Creates a Controller to control the specified element.
	 * @param element - The element to be controlled by this controller.
	 * @param definition - The element definition metadata that instructs this
	 * controller in how to handle rendering and other platform integrations.
	 * @internal
	 */
	constructor(element, definition) {
		super(element)
		this.boundObservables = null
		this.behaviors = null
		this.needsInitialization = true
		this._template = null
		this._styles = null
		this._isConnected = false
		/**
		 * This allows Observable.getNotifier(...) to return the Controller
		 * when the notifier for the Controller itself is being requested. The
		 * result is that the Observable system does not need to create a separate
		 * instance of Notifier for observables on the Controller. The component and
		 * the controller will now share the same notifier, removing one-object construct
		 * per web component instance.
		 */
		this.$fastController = this
		/**
		 * The view associated with the custom element.
		 * @remarks
		 * If `null` then the element is managing its own rendering.
		 */
		this.view = null
		this.element = element
		this.definition = definition
		const shadowOptions = definition.shadowOptions
		if (shadowOptions !== void 0) {
			const shadowRoot = element.attachShadow(shadowOptions)
			if (shadowOptions.mode === "closed") {
				shadowRoots.set(element, shadowRoot)
			}
		}
		// Capture any observable values that were set by the binding engine before
		// the browser upgraded the element. Then delete the property since it will
		// shadow the getter/setter that is required to make the observable operate.
		// Later, in the connect callback, we'll re-apply the values.
		const accessors = Observable.getAccessors(element)
		if (accessors.length > 0) {
			const boundObservables = (this.boundObservables = Object.create(null))
			for (let i = 0, ii = accessors.length; i < ii; ++i) {
				const propertyName = accessors[i].name
				const value = element[propertyName]
				if (value !== void 0) {
					delete element[propertyName]
					boundObservables[propertyName] = value
				}
			}
		}
	}
	/**
	 * Indicates whether or not the custom element has been
	 * connected to the document.
	 */
	get isConnected() {
		Observable.track(this, "isConnected")
		return this._isConnected
	}
	setIsConnected(value) {
		this._isConnected = value
		Observable.notify(this, "isConnected")
	}
	/**
	 * Gets/sets the template used to render the component.
	 * @remarks
	 * This value can only be accurately read after connect but can be set at any time.
	 */
	get template() {
		return this._template
	}
	set template(value) {
		if (this._template === value) {
			return
		}
		this._template = value
		if (!this.needsInitialization) {
			this.renderTemplate(value)
		}
	}
	/**
	 * Gets/sets the primary styles used for the component.
	 * @remarks
	 * This value can only be accurately read after connect but can be set at any time.
	 */
	get styles() {
		return this._styles
	}
	set styles(value) {
		if (this._styles === value) {
			return
		}
		if (this._styles !== null) {
			this.removeStyles(this._styles)
		}
		this._styles = value
		if (!this.needsInitialization && value !== null) {
			this.addStyles(value)
		}
	}
	/**
	 * Adds styles to this element. Providing an HTMLStyleElement will attach the element instance to the shadowRoot.
	 * @param styles - The styles to add.
	 */
	addStyles(styles) {
		const target = getShadowRoot(this.element) || this.element.getRootNode()
		if (styles instanceof HTMLStyleElement) {
			target.append(styles)
		} else if (!styles.isAttachedTo(target)) {
			const sourceBehaviors = styles.behaviors
			styles.addStylesTo(target)
			if (sourceBehaviors !== null) {
				this.addBehaviors(sourceBehaviors)
			}
		}
	}
	/**
	 * Removes styles from this element. Providing an HTMLStyleElement will detach the element instance from the shadowRoot.
	 * @param styles - the styles to remove.
	 */
	removeStyles(styles) {
		const target = getShadowRoot(this.element) || this.element.getRootNode()
		if (styles instanceof HTMLStyleElement) {
			target.removeChild(styles)
		} else if (styles.isAttachedTo(target)) {
			const sourceBehaviors = styles.behaviors
			styles.removeStylesFrom(target)
			if (sourceBehaviors !== null) {
				this.removeBehaviors(sourceBehaviors)
			}
		}
	}
	/**
	 * Adds behaviors to this element.
	 * @param behaviors - The behaviors to add.
	 */
	addBehaviors(behaviors) {
		const targetBehaviors = this.behaviors || (this.behaviors = new Map())
		const length = behaviors.length
		const behaviorsToBind = []
		for (let i = 0; i < length; ++i) {
			const behavior = behaviors[i]
			if (targetBehaviors.has(behavior)) {
				targetBehaviors.set(behavior, targetBehaviors.get(behavior) + 1)
			} else {
				targetBehaviors.set(behavior, 1)
				behaviorsToBind.push(behavior)
			}
		}
		if (this._isConnected) {
			const element = this.element
			for (let i = 0; i < behaviorsToBind.length; ++i) {
				behaviorsToBind[i].bind(element, defaultExecutionContext)
			}
		}
	}
	/**
	 * Removes behaviors from this element.
	 * @param behaviors - The behaviors to remove.
	 * @param force - Forces unbinding of behaviors.
	 */
	removeBehaviors(behaviors, force = false) {
		const targetBehaviors = this.behaviors
		if (targetBehaviors === null) {
			return
		}
		const length = behaviors.length
		const behaviorsToUnbind = []
		for (let i = 0; i < length; ++i) {
			const behavior = behaviors[i]
			if (targetBehaviors.has(behavior)) {
				const count = targetBehaviors.get(behavior) - 1
				count === 0 || force
					? targetBehaviors.delete(behavior) && behaviorsToUnbind.push(behavior)
					: targetBehaviors.set(behavior, count)
			}
		}
		if (this._isConnected) {
			const element = this.element
			for (let i = 0; i < behaviorsToUnbind.length; ++i) {
				behaviorsToUnbind[i].unbind(element)
			}
		}
	}
	/**
	 * Runs connected lifecycle behavior on the associated element.
	 */
	onConnectedCallback() {
		if (this._isConnected) {
			return
		}
		const element = this.element
		if (this.needsInitialization) {
			this.finishInitialization()
		} else if (this.view !== null) {
			this.view.bind(element, defaultExecutionContext)
		}
		const behaviors = this.behaviors
		if (behaviors !== null) {
			for (const [behavior] of behaviors) {
				behavior.bind(element, defaultExecutionContext)
			}
		}
		this.setIsConnected(true)
	}
	/**
	 * Runs disconnected lifecycle behavior on the associated element.
	 */
	onDisconnectedCallback() {
		if (!this._isConnected) {
			return
		}
		this.setIsConnected(false)
		const view = this.view
		if (view !== null) {
			view.unbind()
		}
		const behaviors = this.behaviors
		if (behaviors !== null) {
			const element = this.element
			for (const [behavior] of behaviors) {
				behavior.unbind(element)
			}
		}
	}
	/**
	 * Runs the attribute changed callback for the associated element.
	 * @param name - The name of the attribute that changed.
	 * @param oldValue - The previous value of the attribute.
	 * @param newValue - The new value of the attribute.
	 */
	onAttributeChangedCallback(name, oldValue, newValue) {
		const attrDef = this.definition.attributeLookup[name]
		if (attrDef !== void 0) {
			attrDef.onAttributeChangedCallback(this.element, newValue)
		}
	}
	/**
	 * Emits a custom HTML event.
	 * @param type - The type name of the event.
	 * @param detail - The event detail object to send with the event.
	 * @param options - The event options. By default bubbles and composed.
	 * @remarks
	 * Only emits events if connected.
	 */
	emit(type, detail, options) {
		if (this._isConnected) {
			return this.element.dispatchEvent(
				new CustomEvent(
					type,
					Object.assign(
						Object.assign(
							{
								detail,
							},
							defaultEventOptions,
						),
						options,
					),
				),
			)
		}
		return false
	}
	finishInitialization() {
		const element = this.element
		const boundObservables = this.boundObservables
		// If we have any observables that were bound, re-apply their values.
		if (boundObservables !== null) {
			const propertyNames = Object.keys(boundObservables)
			for (let i = 0, ii = propertyNames.length; i < ii; ++i) {
				const propertyName = propertyNames[i]
				element[propertyName] = boundObservables[propertyName]
			}
			this.boundObservables = null
		}
		const definition = this.definition
		// 1. Template overrides take top precedence.
		if (this._template === null) {
			if (this.element.resolveTemplate) {
				// 2. Allow for element instance overrides next.
				this._template = this.element.resolveTemplate()
			} else if (definition.template) {
				// 3. Default to the static definition.
				this._template = definition.template || null
			}
		}
		// If we have a template after the above process, render it.
		// If there's no template, then the element author has opted into
		// custom rendering and they will managed the shadow root's content themselves.
		if (this._template !== null) {
			this.renderTemplate(this._template)
		}
		// 1. Styles overrides take top precedence.
		if (this._styles === null) {
			if (this.element.resolveStyles) {
				// 2. Allow for element instance overrides next.
				this._styles = this.element.resolveStyles()
			} else if (definition.styles) {
				// 3. Default to the static definition.
				this._styles = definition.styles || null
			}
		}
		// If we have styles after the above process, add them.
		if (this._styles !== null) {
			this.addStyles(this._styles)
		}
		this.needsInitialization = false
	}
	renderTemplate(template) {
		const element = this.element
		// When getting the host to render to, we start by looking
		// up the shadow root. If there isn't one, then that means
		// we're doing a Light DOM render to the element's direct children.
		const host = getShadowRoot(element) || element
		if (this.view !== null) {
			// If there's already a view, we need to unbind and remove through dispose.
			this.view.dispose()
			this.view = null
		} else if (!this.needsInitialization) {
			// If there was previous custom rendering, we need to clear out the host.
			DOM.removeChildNodes(host)
		}
		if (template) {
			// If a new template was provided, render it.
			this.view = template.render(element, host, element)
		}
	}
	/**
	 * Locates or creates a controller for the specified element.
	 * @param element - The element to return the controller for.
	 * @remarks
	 * The specified element must have a {@link FASTElementDefinition}
	 * registered either through the use of the {@link customElement}
	 * decorator or a call to `FASTElement.define`.
	 */
	static forCustomElement(element) {
		const controller = element.$fastController
		if (controller !== void 0) {
			return controller
		}
		const definition = FASTElementDefinition.forType(element.constructor)
		if (definition === void 0) {
			throw new Error("Missing FASTElement definition.")
		}
		return (element.$fastController = new Controller(element, definition))
	}
}

/* eslint-disable-next-line @typescript-eslint/explicit-function-return-type */
function createFASTElement(BaseType) {
	return class extends BaseType {
		constructor() {
			/* eslint-disable-next-line */
			super()
			Controller.forCustomElement(this)
		}
		$emit(type, detail, options) {
			return this.$fastController.emit(type, detail, options)
		}
		connectedCallback() {
			this.$fastController.onConnectedCallback()
		}
		disconnectedCallback() {
			this.$fastController.onDisconnectedCallback()
		}
		attributeChangedCallback(name, oldValue, newValue) {
			this.$fastController.onAttributeChangedCallback(name, oldValue, newValue)
		}
	}
}
/**
 * A minimal base class for FASTElements that also provides
 * static helpers for working with FASTElements.
 * @public
 */
const FASTElement = Object.assign(createFASTElement(HTMLElement), {
	/**
	 * Creates a new FASTElement base class inherited from the
	 * provided base type.
	 * @param BaseType - The base element type to inherit from.
	 */
	from(BaseType) {
		return createFASTElement(BaseType)
	},
	/**
	 * Defines a platform custom element based on the provided type and definition.
	 * @param type - The custom element type to define.
	 * @param nameOrDef - The name of the element to define or a definition object
	 * that describes the element to define.
	 */
	define(type, nameOrDef) {
		return new FASTElementDefinition(type, nameOrDef).define().type
	},
})

/**
 * Directive for use in {@link css}.
 *
 * @public
 */
class CSSDirective {
	/**
	 * Creates a CSS fragment to interpolate into the CSS document.
	 * @returns - the string to interpolate into CSS
	 */
	createCSS() {
		return ""
	}
	/**
	 * Creates a behavior to bind to the host element.
	 * @returns - the behavior to bind to the host element, or undefined.
	 */
	createBehavior() {
		return undefined
	}
}

function collectStyles(strings, values) {
	const styles = []
	let cssString = ""
	const behaviors = []
	for (let i = 0, ii = strings.length - 1; i < ii; ++i) {
		cssString += strings[i]
		let value = values[i]
		if (value instanceof CSSDirective) {
			const behavior = value.createBehavior()
			value = value.createCSS()
			if (behavior) {
				behaviors.push(behavior)
			}
		}
		if (value instanceof ElementStyles || value instanceof CSSStyleSheet) {
			if (cssString.trim() !== "") {
				styles.push(cssString)
				cssString = ""
			}
			styles.push(value)
		} else {
			cssString += value
		}
	}
	cssString += strings[strings.length - 1]
	if (cssString.trim() !== "") {
		styles.push(cssString)
	}
	return {
		styles,
		behaviors,
	}
}
/**
 * Transforms a template literal string into styles.
 * @param strings - The string fragments that are interpolated with the values.
 * @param values - The values that are interpolated with the string fragments.
 * @remarks
 * The css helper supports interpolation of strings and ElementStyle instances.
 * @public
 */
function css(strings, ...values) {
	const { styles, behaviors } = collectStyles(strings, values)
	const elementStyles = ElementStyles.create(styles)
	if (behaviors.length) {
		elementStyles.withBehaviors(...behaviors)
	}
	return elementStyles
}
class CSSPartial extends CSSDirective {
	constructor(styles, behaviors) {
		super()
		this.behaviors = behaviors
		this.css = ""
		const stylesheets = styles.reduce((accumulated, current) => {
			if (typeof current === "string") {
				this.css += current
			} else {
				accumulated.push(current)
			}
			return accumulated
		}, [])
		if (stylesheets.length) {
			this.styles = ElementStyles.create(stylesheets)
		}
	}
	createBehavior() {
		return this
	}
	createCSS() {
		return this.css
	}
	bind(el) {
		if (this.styles) {
			el.$fastController.addStyles(this.styles)
		}
		if (this.behaviors.length) {
			el.$fastController.addBehaviors(this.behaviors)
		}
	}
	unbind(el) {
		if (this.styles) {
			el.$fastController.removeStyles(this.styles)
		}
		if (this.behaviors.length) {
			el.$fastController.removeBehaviors(this.behaviors)
		}
	}
}

/** @internal */
function newSplice(index, removed, addedCount) {
	return {
		index: index,
		removed: removed,
		addedCount: addedCount,
	}
}
const EDIT_LEAVE = 0
const EDIT_UPDATE = 1
const EDIT_ADD = 2
const EDIT_DELETE = 3
// Note: This function is *based* on the computation of the Levenshtein
// "edit" distance. The one change is that "updates" are treated as two
// edits - not one. With Array splices, an update is really a delete
// followed by an add. By retaining this, we optimize for "keeping" the
// maximum array items in the original array. For example:
//
//   'xxxx123' -> '123yyyy'
//
// With 1-edit updates, the shortest path would be just to update all seven
// characters. With 2-edit updates, we delete 4, leave 3, and add 4. This
// leaves the substring '123' intact.
function calcEditDistances(current, currentStart, currentEnd, old, oldStart, oldEnd) {
	// "Deletion" columns
	const rowCount = oldEnd - oldStart + 1
	const columnCount = currentEnd - currentStart + 1
	const distances = new Array(rowCount)
	let north
	let west
	// "Addition" rows. Initialize null column.
	for (let i = 0; i < rowCount; ++i) {
		distances[i] = new Array(columnCount)
		distances[i][0] = i
	}
	// Initialize null row
	for (let j = 0; j < columnCount; ++j) {
		distances[0][j] = j
	}
	for (let i = 1; i < rowCount; ++i) {
		for (let j = 1; j < columnCount; ++j) {
			if (current[currentStart + j - 1] === old[oldStart + i - 1]) {
				distances[i][j] = distances[i - 1][j - 1]
			} else {
				north = distances[i - 1][j] + 1
				west = distances[i][j - 1] + 1
				distances[i][j] = north < west ? north : west
			}
		}
	}
	return distances
}
// This starts at the final weight, and walks "backward" by finding
// the minimum previous weight recursively until the origin of the weight
// matrix.
function spliceOperationsFromEditDistances(distances) {
	let i = distances.length - 1
	let j = distances[0].length - 1
	let current = distances[i][j]
	const edits = []
	while (i > 0 || j > 0) {
		if (i === 0) {
			edits.push(EDIT_ADD)
			j--
			continue
		}
		if (j === 0) {
			edits.push(EDIT_DELETE)
			i--
			continue
		}
		const northWest = distances[i - 1][j - 1]
		const west = distances[i - 1][j]
		const north = distances[i][j - 1]
		let min
		if (west < north) {
			min = west < northWest ? west : northWest
		} else {
			min = north < northWest ? north : northWest
		}
		if (min === northWest) {
			if (northWest === current) {
				edits.push(EDIT_LEAVE)
			} else {
				edits.push(EDIT_UPDATE)
				current = northWest
			}
			i--
			j--
		} else if (min === west) {
			edits.push(EDIT_DELETE)
			i--
			current = west
		} else {
			edits.push(EDIT_ADD)
			j--
			current = north
		}
	}
	edits.reverse()
	return edits
}
function sharedPrefix(current, old, searchLength) {
	for (let i = 0; i < searchLength; ++i) {
		if (current[i] !== old[i]) {
			return i
		}
	}
	return searchLength
}
function sharedSuffix(current, old, searchLength) {
	let index1 = current.length
	let index2 = old.length
	let count = 0
	while (count < searchLength && current[--index1] === old[--index2]) {
		count++
	}
	return count
}
function intersect(start1, end1, start2, end2) {
	// Disjoint
	if (end1 < start2 || end2 < start1) {
		return -1
	}
	// Adjacent
	if (end1 === start2 || end2 === start1) {
		return 0
	}
	// Non-zero intersect, span1 first
	if (start1 < start2) {
		if (end1 < end2) {
			return end1 - start2 // Overlap
		}

		return end2 - start2 // Contained
	}
	// Non-zero intersect, span2 first
	if (end2 < end1) {
		return end2 - start1 // Overlap
	}

	return end1 - start1 // Contained
}
/**
 * Splice Projection functions:
 *
 * A splice map is a representation of how a previous array of items
 * was transformed into a new array of items. Conceptually it is a list of
 * tuples of
 *
 *   <index, removed, addedCount>
 *
 * which are kept in ascending index order of. The tuple represents that at
 * the |index|, |removed| sequence of items were removed, and counting forward
 * from |index|, |addedCount| items were added.
 */
/**
 * @internal
 * @remarks
 * Lacking individual splice mutation information, the minimal set of
 * splices can be synthesized given the previous state and final state of an
 * array. The basic approach is to calculate the edit distance matrix and
 * choose the shortest path through it.
 *
 * Complexity: O(l * p)
 *   l: The length of the current array
 *   p: The length of the old array
 */
function calcSplices(current, currentStart, currentEnd, old, oldStart, oldEnd) {
	let prefixCount = 0
	let suffixCount = 0
	const minLength = Math.min(currentEnd - currentStart, oldEnd - oldStart)
	if (currentStart === 0 && oldStart === 0) {
		prefixCount = sharedPrefix(current, old, minLength)
	}
	if (currentEnd === current.length && oldEnd === old.length) {
		suffixCount = sharedSuffix(current, old, minLength - prefixCount)
	}
	currentStart += prefixCount
	oldStart += prefixCount
	currentEnd -= suffixCount
	oldEnd -= suffixCount
	if (currentEnd - currentStart === 0 && oldEnd - oldStart === 0) {
		return emptyArray
	}
	if (currentStart === currentEnd) {
		const splice = newSplice(currentStart, [], 0)
		while (oldStart < oldEnd) {
			splice.removed.push(old[oldStart++])
		}
		return [splice]
	} else if (oldStart === oldEnd) {
		return [newSplice(currentStart, [], currentEnd - currentStart)]
	}
	const ops = spliceOperationsFromEditDistances(calcEditDistances(current, currentStart, currentEnd, old, oldStart, oldEnd))
	const splices = []
	let splice = void 0
	let index = currentStart
	let oldIndex = oldStart
	for (let i = 0; i < ops.length; ++i) {
		switch (ops[i]) {
			case EDIT_LEAVE:
				if (splice !== void 0) {
					splices.push(splice)
					splice = void 0
				}
				index++
				oldIndex++
				break
			case EDIT_UPDATE:
				if (splice === void 0) {
					splice = newSplice(index, [], 0)
				}
				splice.addedCount++
				index++
				splice.removed.push(old[oldIndex])
				oldIndex++
				break
			case EDIT_ADD:
				if (splice === void 0) {
					splice = newSplice(index, [], 0)
				}
				splice.addedCount++
				index++
				break
			case EDIT_DELETE:
				if (splice === void 0) {
					splice = newSplice(index, [], 0)
				}
				splice.removed.push(old[oldIndex])
				oldIndex++
				break
			// no default
		}
	}

	if (splice !== void 0) {
		splices.push(splice)
	}
	return splices
}
const $push = Array.prototype.push
function mergeSplice(splices, index, removed, addedCount) {
	const splice = newSplice(index, removed, addedCount)
	let inserted = false
	let insertionOffset = 0
	for (let i = 0; i < splices.length; i++) {
		const current = splices[i]
		current.index += insertionOffset
		if (inserted) {
			continue
		}
		const intersectCount = intersect(
			splice.index,
			splice.index + splice.removed.length,
			current.index,
			current.index + current.addedCount,
		)
		if (intersectCount >= 0) {
			// Merge the two splices
			splices.splice(i, 1)
			i--
			insertionOffset -= current.addedCount - current.removed.length
			splice.addedCount += current.addedCount - intersectCount
			const deleteCount = splice.removed.length + current.removed.length - intersectCount
			if (!splice.addedCount && !deleteCount) {
				// merged splice is a noop. discard.
				inserted = true
			} else {
				let currentRemoved = current.removed
				if (splice.index < current.index) {
					// some prefix of splice.removed is prepended to current.removed.
					const prepend = splice.removed.slice(0, current.index - splice.index)
					$push.apply(prepend, currentRemoved)
					currentRemoved = prepend
				}
				if (splice.index + splice.removed.length > current.index + current.addedCount) {
					// some suffix of splice.removed is appended to current.removed.
					const append = splice.removed.slice(current.index + current.addedCount - splice.index)
					$push.apply(currentRemoved, append)
				}
				splice.removed = currentRemoved
				if (current.index < splice.index) {
					splice.index = current.index
				}
			}
		} else if (splice.index < current.index) {
			// Insert splice here.
			inserted = true
			splices.splice(i, 0, splice)
			i++
			const offset = splice.addedCount - splice.removed.length
			current.index += offset
			insertionOffset += offset
		}
	}
	if (!inserted) {
		splices.push(splice)
	}
}
function createInitialSplices(changeRecords) {
	const splices = []
	for (let i = 0, ii = changeRecords.length; i < ii; i++) {
		const record = changeRecords[i]
		mergeSplice(splices, record.index, record.removed, record.addedCount)
	}
	return splices
}
/** @internal */
function projectArraySplices(array, changeRecords) {
	let splices = []
	const initialSplices = createInitialSplices(changeRecords)
	for (let i = 0, ii = initialSplices.length; i < ii; ++i) {
		const splice = initialSplices[i]
		if (splice.addedCount === 1 && splice.removed.length === 1) {
			if (splice.removed[0] !== array[splice.index]) {
				splices.push(splice)
			}
			continue
		}
		splices = splices.concat(
			calcSplices(array, splice.index, splice.index + splice.addedCount, splice.removed, 0, splice.removed.length),
		)
	}
	return splices
}

let arrayObservationEnabled = false
function adjustIndex(changeRecord, array) {
	let index = changeRecord.index
	const arrayLength = array.length
	if (index > arrayLength) {
		index = arrayLength - changeRecord.addedCount
	} else if (index < 0) {
		index = arrayLength + changeRecord.removed.length + index - changeRecord.addedCount
	}
	if (index < 0) {
		index = 0
	}
	changeRecord.index = index
	return changeRecord
}
class ArrayObserver extends SubscriberSet {
	constructor(source) {
		super(source)
		this.oldCollection = void 0
		this.splices = void 0
		this.needsQueue = true
		this.call = this.flush
		Reflect.defineProperty(source, "$fastController", {
			value: this,
			enumerable: false,
		})
	}
	subscribe(subscriber) {
		this.flush()
		super.subscribe(subscriber)
	}
	addSplice(splice) {
		if (this.splices === void 0) {
			this.splices = [splice]
		} else {
			this.splices.push(splice)
		}
		if (this.needsQueue) {
			this.needsQueue = false
			DOM.queueUpdate(this)
		}
	}
	reset(oldCollection) {
		this.oldCollection = oldCollection
		if (this.needsQueue) {
			this.needsQueue = false
			DOM.queueUpdate(this)
		}
	}
	flush() {
		const splices = this.splices
		const oldCollection = this.oldCollection
		if (splices === void 0 && oldCollection === void 0) {
			return
		}
		this.needsQueue = true
		this.splices = void 0
		this.oldCollection = void 0
		const finalSplices =
			oldCollection === void 0
				? projectArraySplices(this.source, splices)
				: calcSplices(this.source, 0, this.source.length, oldCollection, 0, oldCollection.length)
		this.notify(finalSplices)
	}
}
/* eslint-disable prefer-rest-params */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Enables the array observation mechanism.
 * @remarks
 * Array observation is enabled automatically when using the
 * {@link RepeatDirective}, so calling this API manually is
 * not typically necessary.
 * @public
 */
function enableArrayObservation() {
	if (arrayObservationEnabled) {
		return
	}
	arrayObservationEnabled = true
	Observable.setArrayObserverFactory((collection) => {
		return new ArrayObserver(collection)
	})
	const proto = Array.prototype
	// Don't patch Array if it has already been patched
	// by another copy of fast-element.
	if (proto.$fastPatch) {
		return
	}
	Reflect.defineProperty(proto, "$fastPatch", {
		value: 1,
		enumerable: false,
	})
	const pop = proto.pop
	const push = proto.push
	const reverse = proto.reverse
	const shift = proto.shift
	const sort = proto.sort
	const splice = proto.splice
	const unshift = proto.unshift
	proto.pop = function () {
		const notEmpty = this.length > 0
		const methodCallResult = pop.apply(this, arguments)
		const o = this.$fastController
		if (o !== void 0 && notEmpty) {
			o.addSplice(newSplice(this.length, [methodCallResult], 0))
		}
		return methodCallResult
	}
	proto.push = function () {
		const methodCallResult = push.apply(this, arguments)
		const o = this.$fastController
		if (o !== void 0) {
			o.addSplice(adjustIndex(newSplice(this.length - arguments.length, [], arguments.length), this))
		}
		return methodCallResult
	}
	proto.reverse = function () {
		let oldArray
		const o = this.$fastController
		if (o !== void 0) {
			o.flush()
			oldArray = this.slice()
		}
		const methodCallResult = reverse.apply(this, arguments)
		if (o !== void 0) {
			o.reset(oldArray)
		}
		return methodCallResult
	}
	proto.shift = function () {
		const notEmpty = this.length > 0
		const methodCallResult = shift.apply(this, arguments)
		const o = this.$fastController
		if (o !== void 0 && notEmpty) {
			o.addSplice(newSplice(0, [methodCallResult], 0))
		}
		return methodCallResult
	}
	proto.sort = function () {
		let oldArray
		const o = this.$fastController
		if (o !== void 0) {
			o.flush()
			oldArray = this.slice()
		}
		const methodCallResult = sort.apply(this, arguments)
		if (o !== void 0) {
			o.reset(oldArray)
		}
		return methodCallResult
	}
	proto.splice = function () {
		const methodCallResult = splice.apply(this, arguments)
		const o = this.$fastController
		if (o !== void 0) {
			o.addSplice(
				adjustIndex(newSplice(+arguments[0], methodCallResult, arguments.length > 2 ? arguments.length - 2 : 0), this),
			)
		}
		return methodCallResult
	}
	proto.unshift = function () {
		const methodCallResult = unshift.apply(this, arguments)
		const o = this.$fastController
		if (o !== void 0) {
			o.addSplice(adjustIndex(newSplice(0, [], arguments.length), this))
		}
		return methodCallResult
	}
}
/* eslint-enable prefer-rest-params */
/* eslint-enable @typescript-eslint/explicit-function-return-type */

/**
 * The runtime behavior for template references.
 * @public
 */
class RefBehavior {
	/**
	 * Creates an instance of RefBehavior.
	 * @param target - The element to reference.
	 * @param propertyName - The name of the property to assign the reference to.
	 */
	constructor(target, propertyName) {
		this.target = target
		this.propertyName = propertyName
	}
	/**
	 * Bind this behavior to the source.
	 * @param source - The source to bind to.
	 * @param context - The execution context that the binding is operating within.
	 */
	bind(source) {
		source[this.propertyName] = this.target
	}
	/**
	 * Unbinds this behavior from the source.
	 * @param source - The source to unbind from.
	 */
	/* eslint-disable-next-line @typescript-eslint/no-empty-function */
	unbind() {}
}
/**
 * A directive that observes the updates a property with a reference to the element.
 * @param propertyName - The name of the property to assign the reference to.
 * @public
 */
function ref(propertyName) {
	return new AttachedBehaviorHTMLDirective("fast-ref", RefBehavior, propertyName)
}

/**
 * Determines whether or not an object is a function.
 * @public
 */
const isFunction = (object) => typeof object === "function"

const noTemplate = () => null
function normalizeBinding(value) {
	return value === undefined ? noTemplate : isFunction(value) ? value : () => value
}
/**
 * A directive that enables basic conditional rendering in a template.
 * @param binding - The condition to test for rendering.
 * @param templateOrTemplateBinding - The template or a binding that gets
 * the template to render when the condition is true.
 * @param elseTemplateOrTemplateBinding - Optional template or binding that that
 * gets the template to render when the conditional is false.
 * @public
 */
function when(binding, templateOrTemplateBinding, elseTemplateOrTemplateBinding) {
	const dataBinding = isFunction(binding) ? binding : () => binding
	const templateBinding = normalizeBinding(templateOrTemplateBinding)
	const elseBinding = normalizeBinding(elseTemplateOrTemplateBinding)
	return (source, context) => (dataBinding(source, context) ? templateBinding(source, context) : elseBinding(source, context))
}

Object.freeze({
	positioning: false,
	recycle: true,
})
function bindWithoutPositioning(view, items, index, context) {
	view.bind(items[index], context)
}
function bindWithPositioning(view, items, index, context) {
	const childContext = Object.create(context)
	childContext.index = index
	childContext.length = items.length
	view.bind(items[index], childContext)
}
/**
 * A behavior that renders a template for each item in an array.
 * @public
 */
class RepeatBehavior {
	/**
	 * Creates an instance of RepeatBehavior.
	 * @param location - The location in the DOM to render the repeat.
	 * @param itemsBinding - The array to render.
	 * @param isItemsBindingVolatile - Indicates whether the items binding has volatile dependencies.
	 * @param templateBinding - The template to render for each item.
	 * @param isTemplateBindingVolatile - Indicates whether the template binding has volatile dependencies.
	 * @param options - Options used to turn on special repeat features.
	 */
	constructor(location, itemsBinding, isItemsBindingVolatile, templateBinding, isTemplateBindingVolatile, options) {
		this.location = location
		this.itemsBinding = itemsBinding
		this.templateBinding = templateBinding
		this.options = options
		this.source = null
		this.views = []
		this.items = null
		this.itemsObserver = null
		this.originalContext = void 0
		this.childContext = void 0
		this.bindView = bindWithoutPositioning
		this.itemsBindingObserver = Observable.binding(itemsBinding, this, isItemsBindingVolatile)
		this.templateBindingObserver = Observable.binding(templateBinding, this, isTemplateBindingVolatile)
		if (options.positioning) {
			this.bindView = bindWithPositioning
		}
	}
	/**
	 * Bind this behavior to the source.
	 * @param source - The source to bind to.
	 * @param context - The execution context that the binding is operating within.
	 */
	bind(source, context) {
		this.source = source
		this.originalContext = context
		this.childContext = Object.create(context)
		this.childContext.parent = source
		this.childContext.parentContext = this.originalContext
		this.items = this.itemsBindingObserver.observe(source, this.originalContext)
		this.template = this.templateBindingObserver.observe(source, this.originalContext)
		this.observeItems(true)
		this.refreshAllViews()
	}
	/**
	 * Unbinds this behavior from the source.
	 * @param source - The source to unbind from.
	 */
	unbind() {
		this.source = null
		this.items = null
		if (this.itemsObserver !== null) {
			this.itemsObserver.unsubscribe(this)
		}
		this.unbindAllViews()
		this.itemsBindingObserver.disconnect()
		this.templateBindingObserver.disconnect()
	}
	/** @internal */
	handleChange(source, args) {
		if (source === this.itemsBinding) {
			this.items = this.itemsBindingObserver.observe(this.source, this.originalContext)
			this.observeItems()
			this.refreshAllViews()
		} else if (source === this.templateBinding) {
			this.template = this.templateBindingObserver.observe(this.source, this.originalContext)
			this.refreshAllViews(true)
		} else {
			this.updateViews(args)
		}
	}
	observeItems(force = false) {
		if (!this.items) {
			this.items = emptyArray
			return
		}
		const oldObserver = this.itemsObserver
		const newObserver = (this.itemsObserver = Observable.getNotifier(this.items))
		const hasNewObserver = oldObserver !== newObserver
		if (hasNewObserver && oldObserver !== null) {
			oldObserver.unsubscribe(this)
		}
		if (hasNewObserver || force) {
			newObserver.subscribe(this)
		}
	}
	updateViews(splices) {
		const childContext = this.childContext
		const views = this.views
		const bindView = this.bindView
		const items = this.items
		const template = this.template
		const recycle = this.options.recycle
		const leftoverViews = []
		let leftoverIndex = 0
		let availableViews = 0
		for (let i = 0, ii = splices.length; i < ii; ++i) {
			const splice = splices[i]
			const removed = splice.removed
			let removeIndex = 0
			let addIndex = splice.index
			const end = addIndex + splice.addedCount
			const removedViews = views.splice(splice.index, removed.length)
			const totalAvailableViews = (availableViews = leftoverViews.length + removedViews.length)
			for (; addIndex < end; ++addIndex) {
				const neighbor = views[addIndex]
				const location = neighbor ? neighbor.firstChild : this.location
				let view
				if (recycle && availableViews > 0) {
					if (removeIndex <= totalAvailableViews && removedViews.length > 0) {
						view = removedViews[removeIndex]
						removeIndex++
					} else {
						view = leftoverViews[leftoverIndex]
						leftoverIndex++
					}
					availableViews--
				} else {
					view = template.create()
				}
				views.splice(addIndex, 0, view)
				bindView(view, items, addIndex, childContext)
				view.insertBefore(location)
			}
			if (removedViews[removeIndex]) {
				leftoverViews.push(...removedViews.slice(removeIndex))
			}
		}
		for (let i = leftoverIndex, ii = leftoverViews.length; i < ii; ++i) {
			leftoverViews[i].dispose()
		}
		if (this.options.positioning) {
			for (let i = 0, ii = views.length; i < ii; ++i) {
				const currentContext = views[i].context
				currentContext.length = ii
				currentContext.index = i
			}
		}
	}
	refreshAllViews(templateChanged = false) {
		const items = this.items
		const childContext = this.childContext
		const template = this.template
		const location = this.location
		const bindView = this.bindView
		let itemsLength = items.length
		let views = this.views
		let viewsLength = views.length
		if (itemsLength === 0 || templateChanged || !this.options.recycle) {
			// all views need to be removed
			HTMLView.disposeContiguousBatch(views)
			viewsLength = 0
		}
		if (viewsLength === 0) {
			// all views need to be created
			this.views = views = new Array(itemsLength)
			for (let i = 0; i < itemsLength; ++i) {
				const view = template.create()
				bindView(view, items, i, childContext)
				views[i] = view
				view.insertBefore(location)
			}
		} else {
			// attempt to reuse existing views with new data
			let i = 0
			for (; i < itemsLength; ++i) {
				if (i < viewsLength) {
					const view = views[i]
					bindView(view, items, i, childContext)
				} else {
					const view = template.create()
					bindView(view, items, i, childContext)
					views.push(view)
					view.insertBefore(location)
				}
			}
			const removed = views.splice(i, viewsLength - i)
			for (i = 0, itemsLength = removed.length; i < itemsLength; ++i) {
				removed[i].dispose()
			}
		}
	}
	unbindAllViews() {
		const views = this.views
		for (let i = 0, ii = views.length; i < ii; ++i) {
			views[i].unbind()
		}
	}
}
/**
 * A directive that configures list rendering.
 * @public
 */
class RepeatDirective extends HTMLDirective {
	/**
	 * Creates an instance of RepeatDirective.
	 * @param itemsBinding - The binding that provides the array to render.
	 * @param templateBinding - The template binding used to obtain a template to render for each item in the array.
	 * @param options - Options used to turn on special repeat features.
	 */
	constructor(itemsBinding, templateBinding, options) {
		super()
		this.itemsBinding = itemsBinding
		this.templateBinding = templateBinding
		this.options = options
		/**
		 * Creates a placeholder string based on the directive's index within the template.
		 * @param index - The index of the directive within the template.
		 */
		this.createPlaceholder = DOM.createBlockPlaceholder
		enableArrayObservation()
		this.isItemsBindingVolatile = Observable.isVolatileBinding(itemsBinding)
		this.isTemplateBindingVolatile = Observable.isVolatileBinding(templateBinding)
	}
	/**
	 * Creates a behavior for the provided target node.
	 * @param target - The node instance to create the behavior for.
	 */
	createBehavior(target) {
		return new RepeatBehavior(
			target,
			this.itemsBinding,
			this.isItemsBindingVolatile,
			this.templateBinding,
			this.isTemplateBindingVolatile,
			this.options,
		)
	}
}

/**
 * Creates a function that can be used to filter a Node array, selecting only elements.
 * @param selector - An optional selector to restrict the filter to.
 * @public
 */
function elements(selector) {
	if (selector) {
		return function (value, index, array) {
			return value.nodeType === 1 && value.matches(selector)
		}
	}
	return function (value, index, array) {
		return value.nodeType === 1
	}
}
/**
 * A base class for node observation.
 * @internal
 */
class NodeObservationBehavior {
	/**
	 * Creates an instance of NodeObservationBehavior.
	 * @param target - The target to assign the nodes property on.
	 * @param options - The options to use in configuring node observation.
	 */
	constructor(target, options) {
		this.target = target
		this.options = options
		this.source = null
	}
	/**
	 * Bind this behavior to the source.
	 * @param source - The source to bind to.
	 * @param context - The execution context that the binding is operating within.
	 */
	bind(source) {
		const name = this.options.property
		this.shouldUpdate = Observable.getAccessors(source).some((x) => x.name === name)
		this.source = source
		this.updateTarget(this.computeNodes())
		if (this.shouldUpdate) {
			this.observe()
		}
	}
	/**
	 * Unbinds this behavior from the source.
	 * @param source - The source to unbind from.
	 */
	unbind() {
		this.updateTarget(emptyArray)
		this.source = null
		if (this.shouldUpdate) {
			this.disconnect()
		}
	}
	/** @internal */
	handleEvent() {
		this.updateTarget(this.computeNodes())
	}
	computeNodes() {
		let nodes = this.getNodes()
		if (this.options.filter !== void 0) {
			nodes = nodes.filter(this.options.filter)
		}
		return nodes
	}
	updateTarget(value) {
		this.source[this.options.property] = value
	}
}

/**
 * The runtime behavior for slotted node observation.
 * @public
 */
class SlottedBehavior extends NodeObservationBehavior {
	/**
	 * Creates an instance of SlottedBehavior.
	 * @param target - The slot element target to observe.
	 * @param options - The options to use when observing the slot.
	 */
	constructor(target, options) {
		super(target, options)
	}
	/**
	 * Begins observation of the nodes.
	 */
	observe() {
		this.target.addEventListener("slotchange", this)
	}
	/**
	 * Disconnects observation of the nodes.
	 */
	disconnect() {
		this.target.removeEventListener("slotchange", this)
	}
	/**
	 * Retrieves the nodes that should be assigned to the target.
	 */
	getNodes() {
		return this.target.assignedNodes(this.options)
	}
}
/**
 * A directive that observes the `assignedNodes()` of a slot and updates a property
 * whenever they change.
 * @param propertyOrOptions - The options used to configure slotted node observation.
 * @public
 */
function slotted(propertyOrOptions) {
	if (typeof propertyOrOptions === "string") {
		propertyOrOptions = {
			property: propertyOrOptions,
		}
	}
	return new AttachedBehaviorHTMLDirective("fast-slotted", SlottedBehavior, propertyOrOptions)
}

/**
 * The runtime behavior for child node observation.
 * @public
 */
class ChildrenBehavior extends NodeObservationBehavior {
	/**
	 * Creates an instance of ChildrenBehavior.
	 * @param target - The element target to observe children on.
	 * @param options - The options to use when observing the element children.
	 */
	constructor(target, options) {
		super(target, options)
		this.observer = null
		options.childList = true
	}
	/**
	 * Begins observation of the nodes.
	 */
	observe() {
		if (this.observer === null) {
			this.observer = new MutationObserver(this.handleEvent.bind(this))
		}
		this.observer.observe(this.target, this.options)
	}
	/**
	 * Disconnects observation of the nodes.
	 */
	disconnect() {
		this.observer.disconnect()
	}
	/**
	 * Retrieves the nodes that should be assigned to the target.
	 */
	getNodes() {
		if ("subtree" in this.options) {
			return Array.from(this.target.querySelectorAll(this.options.selector))
		}
		return Array.from(this.target.childNodes)
	}
}
/**
 * A directive that observes the `childNodes` of an element and updates a property
 * whenever they change.
 * @param propertyOrOptions - The options used to configure child node observation.
 * @public
 */
function children(propertyOrOptions) {
	if (typeof propertyOrOptions === "string") {
		propertyOrOptions = {
			property: propertyOrOptions,
		}
	}
	return new AttachedBehaviorHTMLDirective("fast-children", ChildrenBehavior, propertyOrOptions)
}

/**
 * A mixin class implementing start and end elements.
 * These are generally used to decorate text elements with icons or other visual indicators.
 * @public
 */
class StartEnd {
	handleStartContentChange() {
		this.startContainer.classList.toggle("start", this.start.assignedNodes().length > 0)
	}
	handleEndContentChange() {
		this.endContainer.classList.toggle("end", this.end.assignedNodes().length > 0)
	}
}
/**
 * The template for the end element.
 * For use with {@link StartEnd}
 *
 * @public
 */
const endSlotTemplate = (context, definition) =>
	html`<span part="end" ${ref("endContainer")} class=${(x) => (definition.end ? "end" : void 0)}
		><slot name="end" ${ref("end")} @slotchange="${(x) => x.handleEndContentChange()}">${definition.end || ""}</slot></span
	>`
/**
 * The template for the start element.
 * For use with {@link StartEnd}
 *
 * @public
 */
const startSlotTemplate = (context, definition) =>
	html`<span part="start" ${ref("startContainer")} class="${(x) => (definition.start ? "start" : void 0)}"
		><slot name="start" ${ref("start")} @slotchange="${(x) => x.handleStartContentChange()}"
			>${definition.start || ""}</slot
		></span
	>`
/**
 * The template for the end element.
 * For use with {@link StartEnd}
 *
 * @public
 * @deprecated - use endSlotTemplate
 */
html`<span part="end" ${ref("endContainer")}
	><slot name="end" ${ref("end")} @slotchange="${(x) => x.handleEndContentChange()}"></slot
></span>`
/**
 * The template for the start element.
 * For use with {@link StartEnd}
 *
 * @public
 * @deprecated - use startSlotTemplate
 */
html`<span part="start" ${ref("startContainer")}
	><slot name="start" ${ref("start")} @slotchange="${(x) => x.handleStartContentChange()}"></slot
></span>`

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
function __decorate$1(decorators, target, key, desc) {
	var c = arguments.length,
		r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
		d
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc)
	else
		for (var i = decorators.length - 1; i >= 0; i--)
			if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r
	return c > 3 && r && Object.defineProperty(target, key, r), r
}

/**
 * Big thanks to https://github.com/fkleuver and the https://github.com/aurelia/aurelia project
 * for the bulk of this code and many of the associated tests.
 */
// Tiny polyfill for TypeScript's Reflect metadata API.
const metadataByTarget = new Map()
if (!("metadata" in Reflect)) {
	Reflect.metadata = function (key, value) {
		return function (target) {
			Reflect.defineMetadata(key, value, target)
		}
	}
	Reflect.defineMetadata = function (key, value, target) {
		let metadata = metadataByTarget.get(target)
		if (metadata === void 0) {
			metadataByTarget.set(target, (metadata = new Map()))
		}
		metadata.set(key, value)
	}
	Reflect.getOwnMetadata = function (key, target) {
		const metadata = metadataByTarget.get(target)
		if (metadata !== void 0) {
			return metadata.get(key)
		}
		return void 0
	}
}
/**
 * A utility class used that constructs and registers resolvers for a dependency
 * injection container. Supports a standard set of object lifetimes.
 * @public
 */
class ResolverBuilder {
	/**
	 *
	 * @param container - The container to create resolvers for.
	 * @param key - The key to register resolvers under.
	 */
	constructor(container, key) {
		this.container = container
		this.key = key
	}
	/**
	 * Creates a resolver for an existing object instance.
	 * @param value - The instance to resolve.
	 * @returns The resolver.
	 */
	instance(value) {
		return this.registerResolver(0 /* instance */, value)
	}
	/**
	 * Creates a resolver that enforces a singleton lifetime.
	 * @param value - The type to create and cache the singleton for.
	 * @returns The resolver.
	 */
	singleton(value) {
		return this.registerResolver(1 /* singleton */, value)
	}
	/**
	 * Creates a resolver that creates a new instance for every dependency request.
	 * @param value - The type to create instances of.
	 * @returns - The resolver.
	 */
	transient(value) {
		return this.registerResolver(2 /* transient */, value)
	}
	/**
	 * Creates a resolver that invokes a callback function for every dependency resolution
	 * request, allowing custom logic to return the dependency.
	 * @param value - The callback to call during resolution.
	 * @returns The resolver.
	 */
	callback(value) {
		return this.registerResolver(3 /* callback */, value)
	}
	/**
	 * Creates a resolver that invokes a callback function the first time that a dependency
	 * resolution is requested. The returned value is then cached and provided for all
	 * subsequent requests.
	 * @param value - The callback to call during the first resolution.
	 * @returns The resolver.
	 */
	cachedCallback(value) {
		return this.registerResolver(3 /* callback */, cacheCallbackResult(value))
	}
	/**
	 * Aliases the current key to a different key.
	 * @param destinationKey - The key to point the alias to.
	 * @returns The resolver.
	 */
	aliasTo(destinationKey) {
		return this.registerResolver(5 /* alias */, destinationKey)
	}
	registerResolver(strategy, state) {
		const { container, key } = this
		/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
		this.container = this.key = void 0
		return container.registerResolver(key, new ResolverImpl(key, strategy, state))
	}
}
function cloneArrayWithPossibleProps(source) {
	const clone = source.slice()
	const keys = Object.keys(source)
	const len = keys.length
	let key
	for (let i = 0; i < len; ++i) {
		key = keys[i]
		if (!isArrayIndex(key)) {
			clone[key] = source[key]
		}
	}
	return clone
}
/**
 * A set of default resolvers useful in configuring a container.
 * @public
 */
const DefaultResolver = Object.freeze({
	/**
	 * Disables auto-registration and throws for all un-registered dependencies.
	 * @param key - The key to create the resolver for.
	 */
	none(key) {
		throw Error(`${key.toString()} not registered, did you forget to add @singleton()?`)
	},
	/**
	 * Provides default singleton resolution behavior during auto-registration.
	 * @param key - The key to create the resolver for.
	 * @returns The resolver.
	 */
	singleton(key) {
		return new ResolverImpl(key, 1 /* singleton */, key)
	},
	/**
	 * Provides default transient resolution behavior during auto-registration.
	 * @param key - The key to create the resolver for.
	 * @returns The resolver.
	 */
	transient(key) {
		return new ResolverImpl(key, 2 /* transient */, key)
	},
})
/**
 * Configuration for a dependency injection container.
 * @public
 */
const ContainerConfiguration = Object.freeze({
	/**
	 * The default configuration used when creating a DOM-disconnected container.
	 * @remarks
	 * The default creates a root container, with no parent container. It does not handle
	 * owner requests and it uses singleton resolution behavior for auto-registration.
	 */
	default: Object.freeze({
		parentLocator: () => null,
		responsibleForOwnerRequests: false,
		defaultResolver: DefaultResolver.singleton,
	}),
})
const dependencyLookup = new Map()
function getParamTypes(key) {
	return (Type) => {
		return Reflect.getOwnMetadata(key, Type)
	}
}
let rootDOMContainer = null
/**
 * The gateway to dependency injection APIs.
 * @public
 */
const DI = Object.freeze({
	/**
	 * Creates a new dependency injection container.
	 * @param config - The configuration for the container.
	 * @returns A newly created dependency injection container.
	 */
	createContainer(config) {
		return new ContainerImpl(null, Object.assign({}, ContainerConfiguration.default, config))
	},
	/**
	 * Finds the dependency injection container responsible for providing dependencies
	 * to the specified node.
	 * @param node - The node to find the responsible container for.
	 * @returns The container responsible for providing dependencies to the node.
	 * @remarks
	 * This will be the same as the parent container if the specified node
	 * does not itself host a container configured with responsibleForOwnerRequests.
	 */
	findResponsibleContainer(node) {
		const owned = node.$$container$$
		if (owned && owned.responsibleForOwnerRequests) {
			return owned
		}
		return DI.findParentContainer(node)
	},
	/**
	 * Find the dependency injection container up the DOM tree from this node.
	 * @param node - The node to find the parent container for.
	 * @returns The parent container of this node.
	 * @remarks
	 * This will be the same as the responsible container if the specified node
	 * does not itself host a container configured with responsibleForOwnerRequests.
	 */
	findParentContainer(node) {
		const event = new CustomEvent(DILocateParentEventType, {
			bubbles: true,
			composed: true,
			cancelable: true,
			detail: {
				container: void 0,
			},
		})
		node.dispatchEvent(event)
		return event.detail.container || DI.getOrCreateDOMContainer()
	},
	/**
	 * Returns a dependency injection container if one is explicitly owned by the specified
	 * node. If one is not owned, then a new container is created and assigned to the node.
	 * @param node - The node to find or create the container for.
	 * @param config - The configuration for the container if one needs to be created.
	 * @returns The located or created container.
	 * @remarks
	 * This API does not search for a responsible or parent container. It looks only for a container
	 * directly defined on the specified node and creates one at that location if one does not
	 * already exist.
	 */
	getOrCreateDOMContainer(node, config) {
		if (!node) {
			return (
				rootDOMContainer ||
				(rootDOMContainer = new ContainerImpl(
					null,
					Object.assign({}, ContainerConfiguration.default, config, {
						parentLocator: () => null,
					}),
				))
			)
		}
		return (
			node.$$container$$ ||
			new ContainerImpl(
				node,
				Object.assign({}, ContainerConfiguration.default, config, {
					parentLocator: DI.findParentContainer,
				}),
			)
		)
	},
	/**
	 * Gets the "design:paramtypes" metadata for the specified type.
	 * @param Type - The type to get the metadata for.
	 * @returns The metadata array or undefined if no metadata is found.
	 */
	getDesignParamtypes: getParamTypes("design:paramtypes"),
	/**
	 * Gets the "di:paramtypes" metadata for the specified type.
	 * @param Type - The type to get the metadata for.
	 * @returns The metadata array or undefined if no metadata is found.
	 */
	getAnnotationParamtypes: getParamTypes("di:paramtypes"),
	/**
	 *
	 * @param Type - Gets the "di:paramtypes" metadata for the specified type. If none is found,
	 * an empty metadata array is created and added.
	 * @returns The metadata array.
	 */
	getOrCreateAnnotationParamTypes(Type) {
		let annotationParamtypes = this.getAnnotationParamtypes(Type)
		if (annotationParamtypes === void 0) {
			Reflect.defineMetadata("di:paramtypes", (annotationParamtypes = []), Type)
		}
		return annotationParamtypes
	},
	/**
	 * Gets the dependency keys representing what is needed to instantiate the specified type.
	 * @param Type - The type to get the dependencies for.
	 * @returns An array of dependency keys.
	 */
	getDependencies(Type) {
		// Note: Every detail of this getDependencies method is pretty deliberate at the moment, and probably not yet 100% tested from every possible angle,
		// so be careful with making changes here as it can have a huge impact on complex end user apps.
		// Preferably, only make changes to the dependency resolution process via a RFC.
		let dependencies = dependencyLookup.get(Type)
		if (dependencies === void 0) {
			// Type.length is the number of constructor parameters. If this is 0, it could mean the class has an empty constructor
			// but it could also mean the class has no constructor at all (in which case it inherits the constructor from the prototype).
			// Non-zero constructor length + no paramtypes means emitDecoratorMetadata is off, or the class has no decorator.
			// We're not doing anything with the above right now, but it's good to keep in mind for any future issues.
			const inject = Type.inject
			if (inject === void 0) {
				// design:paramtypes is set by tsc when emitDecoratorMetadata is enabled.
				const designParamtypes = DI.getDesignParamtypes(Type)
				// di:paramtypes is set by the parameter decorator from DI.createInterface or by @inject
				const annotationParamtypes = DI.getAnnotationParamtypes(Type)
				if (designParamtypes === void 0) {
					if (annotationParamtypes === void 0) {
						// Only go up the prototype if neither static inject nor any of the paramtypes is defined, as
						// there is no sound way to merge a type's deps with its prototype's deps
						const Proto = Object.getPrototypeOf(Type)
						if (typeof Proto === "function" && Proto !== Function.prototype) {
							dependencies = cloneArrayWithPossibleProps(DI.getDependencies(Proto))
						} else {
							dependencies = []
						}
					} else {
						// No design:paramtypes so just use the di:paramtypes
						dependencies = cloneArrayWithPossibleProps(annotationParamtypes)
					}
				} else if (annotationParamtypes === void 0) {
					// No di:paramtypes so just use the design:paramtypes
					dependencies = cloneArrayWithPossibleProps(designParamtypes)
				} else {
					// We've got both, so merge them (in case of conflict on same index, di:paramtypes take precedence)
					dependencies = cloneArrayWithPossibleProps(designParamtypes)
					let len = annotationParamtypes.length
					let auAnnotationParamtype
					for (let i = 0; i < len; ++i) {
						auAnnotationParamtype = annotationParamtypes[i]
						if (auAnnotationParamtype !== void 0) {
							dependencies[i] = auAnnotationParamtype
						}
					}
					const keys = Object.keys(annotationParamtypes)
					len = keys.length
					let key
					for (let i = 0; i < len; ++i) {
						key = keys[i]
						if (!isArrayIndex(key)) {
							dependencies[key] = annotationParamtypes[key]
						}
					}
				}
			} else {
				// Ignore paramtypes if we have static inject
				dependencies = cloneArrayWithPossibleProps(inject)
			}
			dependencyLookup.set(Type, dependencies)
		}
		return dependencies
	},
	/**
	 * Defines a property on a web component class. The value of this property will
	 * be resolved from the dependency injection container responsible for the element
	 * instance, based on where it is connected in the DOM.
	 * @param target - The target to define the property on.
	 * @param propertyName - The name of the property to define.
	 * @param key - The dependency injection key.
	 * @param respectConnection - Indicates whether or not to update the property value if the
	 * hosting component is disconnected and then re-connected at a different location in the DOM.
	 * @remarks
	 * The respectConnection option is only applicable to elements that descend from FASTElement.
	 */
	defineProperty(target, propertyName, key, respectConnection = false) {
		const diPropertyKey = `$di_${propertyName}`
		Reflect.defineProperty(target, propertyName, {
			get: function () {
				let value = this[diPropertyKey]
				if (value === void 0) {
					const container =
						this instanceof HTMLElement ? DI.findResponsibleContainer(this) : DI.getOrCreateDOMContainer()
					value = container.get(key)
					this[diPropertyKey] = value
					if (respectConnection && this instanceof FASTElement) {
						const notifier = this.$fastController
						const handleChange = () => {
							const newContainer = DI.findResponsibleContainer(this)
							const newValue = newContainer.get(key)
							const oldValue = this[diPropertyKey]
							if (newValue !== oldValue) {
								this[diPropertyKey] = value
								notifier.notify(propertyName)
							}
						}
						notifier.subscribe(
							{
								handleChange,
							},
							"isConnected",
						)
					}
				}
				return value
			},
		})
	},
	/**
	 * Creates a dependency injection key.
	 * @param nameConfigOrCallback - A friendly name for the key or a lambda that configures a
	 * default resolution for the dependency.
	 * @param configuror - If a friendly name was provided for the first parameter, then an optional
	 * lambda that configures a default resolution for the dependency can be provided second.
	 * @returns The created key.
	 * @remarks
	 * The created key can be used as a property decorator or constructor parameter decorator,
	 * in addition to its standard use in an inject array or through direct container APIs.
	 */
	createInterface(nameConfigOrCallback, configuror) {
		const configure = typeof nameConfigOrCallback === "function" ? nameConfigOrCallback : configuror
		const friendlyName =
			typeof nameConfigOrCallback === "string"
				? nameConfigOrCallback
				: nameConfigOrCallback && "friendlyName" in nameConfigOrCallback
					? nameConfigOrCallback.friendlyName || defaultFriendlyName
					: defaultFriendlyName
		const respectConnection =
			typeof nameConfigOrCallback === "string"
				? false
				: nameConfigOrCallback && "respectConnection" in nameConfigOrCallback
					? nameConfigOrCallback.respectConnection || false
					: false
		const Interface = function (target, property, index) {
			if (target == null || new.target !== undefined) {
				throw new Error(`No registration for interface: '${Interface.friendlyName}'`)
			}
			if (property) {
				DI.defineProperty(target, property, Interface, respectConnection)
			} else {
				const annotationParamtypes = DI.getOrCreateAnnotationParamTypes(target)
				annotationParamtypes[index] = Interface
			}
		}
		Interface.$isInterface = true
		Interface.friendlyName = friendlyName == null ? "(anonymous)" : friendlyName
		if (configure != null) {
			Interface.register = function (container, key) {
				return configure(new ResolverBuilder(container, key !== null && key !== void 0 ? key : Interface))
			}
		}
		Interface.toString = function toString() {
			return `InterfaceSymbol<${Interface.friendlyName}>`
		}
		return Interface
	},
	/**
	 * A decorator that specifies what to inject into its target.
	 * @param dependencies - The dependencies to inject.
	 * @returns The decorator to be applied to the target class.
	 * @remarks
	 * The decorator can be used to decorate a class, listing all of the classes dependencies.
	 * Or it can be used to decorate a constructor paramter, indicating what to inject for that
	 * parameter.
	 * Or it can be used for a web component property, indicating what that property should resolve to.
	 */
	inject(...dependencies) {
		return function (target, key, descriptor) {
			if (typeof descriptor === "number") {
				// It's a parameter decorator.
				const annotationParamtypes = DI.getOrCreateAnnotationParamTypes(target)
				const dep = dependencies[0]
				if (dep !== void 0) {
					annotationParamtypes[descriptor] = dep
				}
			} else if (key) {
				DI.defineProperty(target, key, dependencies[0])
			} else {
				const annotationParamtypes = descriptor
					? DI.getOrCreateAnnotationParamTypes(descriptor.value)
					: DI.getOrCreateAnnotationParamTypes(target)
				let dep
				for (let i = 0; i < dependencies.length; ++i) {
					dep = dependencies[i]
					if (dep !== void 0) {
						annotationParamtypes[i] = dep
					}
				}
			}
		}
	},
	/**
	 * Registers the `target` class as a transient dependency; each time the dependency is resolved
	 * a new instance will be created.
	 *
	 * @param target - The class / constructor function to register as transient.
	 * @returns The same class, with a static `register` method that takes a container and returns the appropriate resolver.
	 *
	 * @example
	 * On an existing class
	 * ```ts
	 * class Foo { }
	 * DI.transient(Foo);
	 * ```
	 *
	 * @example
	 * Inline declaration
	 *
	 * ```ts
	 * const Foo = DI.transient(class { });
	 * // Foo is now strongly typed with register
	 * Foo.register(container);
	 * ```
	 *
	 * @public
	 */
	transient(target) {
		target.register = function register(container) {
			const registration = Registration.transient(target, target)
			return registration.register(container)
		}
		target.registerInRequestor = false
		return target
	},
	/**
	 * Registers the `target` class as a singleton dependency; the class will only be created once. Each
	 * consecutive time the dependency is resolved, the same instance will be returned.
	 *
	 * @param target - The class / constructor function to register as a singleton.
	 * @returns The same class, with a static `register` method that takes a container and returns the appropriate resolver.
	 * @example
	 * On an existing class
	 * ```ts
	 * class Foo { }
	 * DI.singleton(Foo);
	 * ```
	 *
	 * @example
	 * Inline declaration
	 * ```ts
	 * const Foo = DI.singleton(class { });
	 * // Foo is now strongly typed with register
	 * Foo.register(container);
	 * ```
	 *
	 * @public
	 */
	singleton(target, options = defaultSingletonOptions) {
		target.register = function register(container) {
			const registration = Registration.singleton(target, target)
			return registration.register(container)
		}
		target.registerInRequestor = options.scoped
		return target
	},
})
/**
 * The interface key that resolves the dependency injection container itself.
 * @public
 */
const Container = DI.createInterface("Container")
/**
 * A decorator that specifies what to inject into its target.
 * @param dependencies - The dependencies to inject.
 * @returns The decorator to be applied to the target class.
 * @remarks
 * The decorator can be used to decorate a class, listing all of the classes dependencies.
 * Or it can be used to decorate a constructor paramter, indicating what to inject for that
 * parameter.
 * Or it can be used for a web component property, indicating what that property should resolve to.
 *
 * @public
 */
DI.inject
const defaultSingletonOptions = {
	scoped: false,
}
/** @internal */
class ResolverImpl {
	constructor(key, strategy, state) {
		this.key = key
		this.strategy = strategy
		this.state = state
		this.resolving = false
	}
	get $isResolver() {
		return true
	}
	register(container) {
		return container.registerResolver(this.key, this)
	}
	resolve(handler, requestor) {
		switch (this.strategy) {
			case 0 /* instance */:
				return this.state
			case 1 /* singleton */: {
				if (this.resolving) {
					throw new Error(`Cyclic dependency found: ${this.state.name}`)
				}
				this.resolving = true
				this.state = handler.getFactory(this.state).construct(requestor)
				this.strategy = 0 /* instance */
				this.resolving = false
				return this.state
			}
			case 2 /* transient */: {
				// Always create transients from the requesting container
				const factory = handler.getFactory(this.state)
				if (factory === null) {
					throw new Error(`Resolver for ${String(this.key)} returned a null factory`)
				}
				return factory.construct(requestor)
			}
			case 3 /* callback */:
				return this.state(handler, requestor, this)
			case 4 /* array */:
				return this.state[0].resolve(handler, requestor)
			case 5 /* alias */:
				return requestor.get(this.state)
			default:
				throw new Error(`Invalid resolver strategy specified: ${this.strategy}.`)
		}
	}
	getFactory(container) {
		var _a, _b, _c
		switch (this.strategy) {
			case 1 /* singleton */:
			case 2 /* transient */:
				return container.getFactory(this.state)
			case 5 /* alias */:
				return (_c =
					(_b = (_a = container.getResolver(this.state)) === null || _a === void 0 ? void 0 : _a.getFactory) === null ||
					_b === void 0
						? void 0
						: _b.call(_a, container)) !== null && _c !== void 0
					? _c
					: null
			default:
				return null
		}
	}
}
function containerGetKey(d) {
	return this.get(d)
}
function transformInstance(inst, transform) {
	return transform(inst)
}
/** @internal */
class FactoryImpl {
	constructor(Type, dependencies) {
		this.Type = Type
		this.dependencies = dependencies
		this.transformers = null
	}
	construct(container, dynamicDependencies) {
		let instance
		if (dynamicDependencies === void 0) {
			instance = new this.Type(...this.dependencies.map(containerGetKey, container))
		} else {
			instance = new this.Type(...this.dependencies.map(containerGetKey, container), ...dynamicDependencies)
		}
		if (this.transformers == null) {
			return instance
		}
		return this.transformers.reduce(transformInstance, instance)
	}
	registerTransformer(transformer) {
		;(this.transformers || (this.transformers = [])).push(transformer)
	}
}
const containerResolver = {
	$isResolver: true,
	resolve(handler, requestor) {
		return requestor
	},
}
function isRegistry(obj) {
	return typeof obj.register === "function"
}
function isSelfRegistry(obj) {
	return isRegistry(obj) && typeof obj.registerInRequestor === "boolean"
}
function isRegisterInRequester(obj) {
	return isSelfRegistry(obj) && obj.registerInRequestor
}
function isClass(obj) {
	return obj.prototype !== void 0
}
const InstrinsicTypeNames = new Set([
	"Array",
	"ArrayBuffer",
	"Boolean",
	"DataView",
	"Date",
	"Error",
	"EvalError",
	"Float32Array",
	"Float64Array",
	"Function",
	"Int8Array",
	"Int16Array",
	"Int32Array",
	"Map",
	"Number",
	"Object",
	"Promise",
	"RangeError",
	"ReferenceError",
	"RegExp",
	"Set",
	"SharedArrayBuffer",
	"String",
	"SyntaxError",
	"TypeError",
	"Uint8Array",
	"Uint8ClampedArray",
	"Uint16Array",
	"Uint32Array",
	"URIError",
	"WeakMap",
	"WeakSet",
])
const DILocateParentEventType = "__DI_LOCATE_PARENT__"
const factories = new Map()
/**
 * @internal
 */
class ContainerImpl {
	constructor(owner, config) {
		this.owner = owner
		this.config = config
		this._parent = void 0
		this.registerDepth = 0
		this.context = null
		if (owner !== null) {
			owner.$$container$$ = this
		}
		this.resolvers = new Map()
		this.resolvers.set(Container, containerResolver)
		if (owner instanceof Node) {
			owner.addEventListener(DILocateParentEventType, (e) => {
				if (e.composedPath()[0] !== this.owner) {
					e.detail.container = this
					e.stopImmediatePropagation()
				}
			})
		}
	}
	get parent() {
		if (this._parent === void 0) {
			this._parent = this.config.parentLocator(this.owner)
		}
		return this._parent
	}
	get depth() {
		return this.parent === null ? 0 : this.parent.depth + 1
	}
	get responsibleForOwnerRequests() {
		return this.config.responsibleForOwnerRequests
	}
	registerWithContext(context, ...params) {
		this.context = context
		this.register(...params)
		this.context = null
		return this
	}
	register(...params) {
		if (++this.registerDepth === 100) {
			throw new Error("Unable to autoregister dependency")
			// Most likely cause is trying to register a plain object that does not have a
			// register method and is not a class constructor
		}

		let current
		let keys
		let value
		let j
		let jj
		const context = this.context
		for (let i = 0, ii = params.length; i < ii; ++i) {
			current = params[i]
			if (!isObject(current)) {
				continue
			}
			if (isRegistry(current)) {
				current.register(this, context)
			} else if (isClass(current)) {
				Registration.singleton(current, current).register(this)
			} else {
				keys = Object.keys(current)
				j = 0
				jj = keys.length
				for (; j < jj; ++j) {
					value = current[keys[j]]
					if (!isObject(value)) {
						continue
					}
					// note: we could remove this if-branch and call this.register directly
					// - the extra check is just a perf tweak to create fewer unnecessary arrays by the spread operator
					if (isRegistry(value)) {
						value.register(this, context)
					} else {
						this.register(value)
					}
				}
			}
		}
		--this.registerDepth
		return this
	}
	registerResolver(key, resolver) {
		validateKey(key)
		const resolvers = this.resolvers
		const result = resolvers.get(key)
		if (result == null) {
			resolvers.set(key, resolver)
		} else if (result instanceof ResolverImpl && result.strategy === 4 /* array */) {
			result.state.push(resolver)
		} else {
			resolvers.set(key, new ResolverImpl(key, 4 /* array */, [result, resolver]))
		}
		return resolver
	}
	registerTransformer(key, transformer) {
		const resolver = this.getResolver(key)
		if (resolver == null) {
			return false
		}
		if (resolver.getFactory) {
			const factory = resolver.getFactory(this)
			if (factory == null) {
				return false
			}
			// This type cast is a bit of a hacky one, necessary due to the duplicity of IResolverLike.
			// Problem is that that interface's type arg can be of type Key, but the getFactory method only works on
			// type Constructable. So the return type of that optional method has this additional constraint, which
			// seems to confuse the type checker.
			factory.registerTransformer(transformer)
			return true
		}
		return false
	}
	getResolver(key, autoRegister = true) {
		validateKey(key)
		if (key.resolve !== void 0) {
			return key
		}
		/* eslint-disable-next-line @typescript-eslint/no-this-alias */
		let current = this
		let resolver
		while (current != null) {
			resolver = current.resolvers.get(key)
			if (resolver == null) {
				if (current.parent == null) {
					const handler = isRegisterInRequester(key) ? this : current
					return autoRegister ? this.jitRegister(key, handler) : null
				}
				current = current.parent
			} else {
				return resolver
			}
		}
		return null
	}
	has(key, searchAncestors = false) {
		return this.resolvers.has(key) ? true : searchAncestors && this.parent != null ? this.parent.has(key, true) : false
	}
	get(key) {
		validateKey(key)
		if (key.$isResolver) {
			return key.resolve(this, this)
		}
		/* eslint-disable-next-line @typescript-eslint/no-this-alias */
		let current = this
		let resolver
		while (current != null) {
			resolver = current.resolvers.get(key)
			if (resolver == null) {
				if (current.parent == null) {
					const handler = isRegisterInRequester(key) ? this : current
					resolver = this.jitRegister(key, handler)
					return resolver.resolve(current, this)
				}
				current = current.parent
			} else {
				return resolver.resolve(current, this)
			}
		}
		throw new Error(`Unable to resolve key: ${String(key)}`)
	}
	getAll(key, searchAncestors = false) {
		validateKey(key)
		/* eslint-disable-next-line @typescript-eslint/no-this-alias */
		const requestor = this
		let current = requestor
		let resolver
		if (searchAncestors) {
			let resolutions = emptyArray
			while (current != null) {
				resolver = current.resolvers.get(key)
				if (resolver != null) {
					resolutions = resolutions.concat(
						/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
						buildAllResponse(resolver, current, requestor),
					)
				}
				current = current.parent
			}
			return resolutions
		} else {
			while (current != null) {
				resolver = current.resolvers.get(key)
				if (resolver == null) {
					current = current.parent
					if (current == null) {
						return emptyArray
					}
				} else {
					return buildAllResponse(resolver, current, requestor)
				}
			}
		}
		return emptyArray
	}
	getFactory(Type) {
		let factory = factories.get(Type)
		if (factory === void 0) {
			if (isNativeFunction(Type)) {
				throw new Error(
					`${Type.name} is a native function and therefore cannot be safely constructed by DI. If this is intentional, please use a callback or cachedCallback resolver.`,
				)
			}
			factories.set(Type, (factory = new FactoryImpl(Type, DI.getDependencies(Type))))
		}
		return factory
	}
	registerFactory(key, factory) {
		factories.set(key, factory)
	}
	createChild(config) {
		return new ContainerImpl(
			null,
			Object.assign({}, this.config, config, {
				parentLocator: () => this,
			}),
		)
	}
	jitRegister(keyAsValue, handler) {
		if (typeof keyAsValue !== "function") {
			throw new Error(
				`Attempted to jitRegister something that is not a constructor: '${keyAsValue}'. Did you forget to register this dependency?`,
			)
		}
		if (InstrinsicTypeNames.has(keyAsValue.name)) {
			throw new Error(`Attempted to jitRegister an intrinsic type: ${keyAsValue.name}. Did you forget to add @inject(Key)`)
		}
		if (isRegistry(keyAsValue)) {
			const registrationResolver = keyAsValue.register(handler)
			if (!(registrationResolver instanceof Object) || registrationResolver.resolve == null) {
				const newResolver = handler.resolvers.get(keyAsValue)
				if (newResolver != void 0) {
					return newResolver
				}
				throw new Error("A valid resolver was not returned from the static register method")
			}
			return registrationResolver
		} else if (keyAsValue.$isInterface) {
			throw new Error(`Attempted to jitRegister an interface: ${keyAsValue.friendlyName}`)
		} else {
			const resolver = this.config.defaultResolver(keyAsValue, handler)
			handler.resolvers.set(keyAsValue, resolver)
			return resolver
		}
	}
}
const cache = new WeakMap()
function cacheCallbackResult(fun) {
	return function (handler, requestor, resolver) {
		if (cache.has(resolver)) {
			return cache.get(resolver)
		}
		const t = fun(handler, requestor, resolver)
		cache.set(resolver, t)
		return t
	}
}
/**
 * You can use the resulting Registration of any of the factory methods
 * to register with the container.
 *
 * @example
 * ```
 * class Foo {}
 * const container = DI.createContainer();
 * container.register(Registration.instance(Foo, new Foo()));
 * container.get(Foo);
 * ```
 *
 * @public
 */
const Registration = Object.freeze({
	/**
	 * Allows you to pass an instance.
	 * Every time you request this {@link Key} you will get this instance back.
	 *
	 * @example
	 * ```
	 * Registration.instance(Foo, new Foo()));
	 * ```
	 *
	 * @param key - The key to register the instance under.
	 * @param value - The instance to return when the key is requested.
	 */
	instance(key, value) {
		return new ResolverImpl(key, 0 /* instance */, value)
	},
	/**
	 * Creates an instance from the class.
	 * Every time you request this {@link Key} you will get the same one back.
	 *
	 * @example
	 * ```
	 * Registration.singleton(Foo, Foo);
	 * ```
	 *
	 * @param key - The key to register the singleton under.
	 * @param value - The class to instantiate as a singleton when first requested.
	 */
	singleton(key, value) {
		return new ResolverImpl(key, 1 /* singleton */, value)
	},
	/**
	 * Creates an instance from a class.
	 * Every time you request this {@link Key} you will get a new instance.
	 *
	 * @example
	 * ```
	 * Registration.instance(Foo, Foo);
	 * ```
	 *
	 * @param key - The key to register the instance type under.
	 * @param value - The class to instantiate each time the key is requested.
	 */
	transient(key, value) {
		return new ResolverImpl(key, 2 /* transient */, value)
	},
	/**
	 * Delegates to a callback function to provide the dependency.
	 * Every time you request this {@link Key} the callback will be invoked to provide
	 * the dependency.
	 *
	 * @example
	 * ```
	 * Registration.callback(Foo, () => new Foo());
	 * Registration.callback(Bar, (c: Container) => new Bar(c.get(Foo)));
	 * ```
	 *
	 * @param key - The key to register the callback for.
	 * @param callback - The function that is expected to return the dependency.
	 */
	callback(key, callback) {
		return new ResolverImpl(key, 3 /* callback */, callback)
	},
	/**
	 * Delegates to a callback function to provide the dependency and then caches the
	 * dependency for future requests.
	 *
	 * @example
	 * ```
	 * Registration.cachedCallback(Foo, () => new Foo());
	 * Registration.cachedCallback(Bar, (c: Container) => new Bar(c.get(Foo)));
	 * ```
	 *
	 * @param key - The key to register the callback for.
	 * @param callback - The function that is expected to return the dependency.
	 * @remarks
	 * If you pass the same Registration to another container, the same cached value will be used.
	 * Should all references to the resolver returned be removed, the cache will expire.
	 */
	cachedCallback(key, callback) {
		return new ResolverImpl(key, 3 /* callback */, cacheCallbackResult(callback))
	},
	/**
	 * Creates an alternate {@link Key} to retrieve an instance by.
	 *
	 * @example
	 * ```
	 * Register.singleton(Foo, Foo)
	 * Register.aliasTo(Foo, MyFoos);
	 *
	 * container.getAll(MyFoos) // contains an instance of Foo
	 * ```
	 *
	 * @param originalKey - The original key that has been registered.
	 * @param aliasKey - The alias to the original key.
	 */
	aliasTo(originalKey, aliasKey) {
		return new ResolverImpl(aliasKey, 5 /* alias */, originalKey)
	},
})
/** @internal */
function validateKey(key) {
	if (key === null || key === void 0) {
		throw new Error(
			"key/value cannot be null or undefined. Are you trying to inject/register something that doesn't exist with DI?",
		)
	}
}
function buildAllResponse(resolver, handler, requestor) {
	if (resolver instanceof ResolverImpl && resolver.strategy === 4 /* array */) {
		const state = resolver.state
		let i = state.length
		const results = new Array(i)
		while (i--) {
			results[i] = state[i].resolve(handler, requestor)
		}
		return results
	}
	return [resolver.resolve(handler, requestor)]
}
const defaultFriendlyName = "(anonymous)"
function isObject(value) {
	return (typeof value === "object" && value !== null) || typeof value === "function"
}
/**
 * Determine whether the value is a native function.
 *
 * @param fn - The function to check.
 * @returns `true` is the function is a native function, otherwise `false`
 */
const isNativeFunction = (function () {
	const lookup = new WeakMap()
	let isNative = false
	let sourceText = ""
	let i = 0
	return function (fn) {
		isNative = lookup.get(fn)
		if (isNative === void 0) {
			sourceText = fn.toString()
			i = sourceText.length
			// http://www.ecma-international.org/ecma-262/#prod-NativeFunction
			isNative =
				// 29 is the length of 'function () { [native code] }' which is the smallest length of a native function string
				i >= 29 &&
				// 100 seems to be a safe upper bound of the max length of a native function. In Chrome and FF it's 56, in Edge it's 61.
				i <= 100 &&
				// This whole heuristic *could* be tricked by a comment. Do we need to care about that?
				sourceText.charCodeAt(i - 1) === 0x7d &&
				// }
				// TODO: the spec is a little vague about the precise constraints, so we do need to test this across various browsers to make sure just one whitespace is a safe assumption.
				sourceText.charCodeAt(i - 2) <= 0x20 &&
				// whitespace
				sourceText.charCodeAt(i - 3) === 0x5d &&
				// ]
				sourceText.charCodeAt(i - 4) === 0x65 &&
				// e
				sourceText.charCodeAt(i - 5) === 0x64 &&
				// d
				sourceText.charCodeAt(i - 6) === 0x6f &&
				// o
				sourceText.charCodeAt(i - 7) === 0x63 &&
				// c
				sourceText.charCodeAt(i - 8) === 0x20 &&
				//
				sourceText.charCodeAt(i - 9) === 0x65 &&
				// e
				sourceText.charCodeAt(i - 10) === 0x76 &&
				// v
				sourceText.charCodeAt(i - 11) === 0x69 &&
				// i
				sourceText.charCodeAt(i - 12) === 0x74 &&
				// t
				sourceText.charCodeAt(i - 13) === 0x61 &&
				// a
				sourceText.charCodeAt(i - 14) === 0x6e &&
				// n
				sourceText.charCodeAt(i - 15) === 0x58 // [
			lookup.set(fn, isNative)
		}
		return isNative
	}
})()
const isNumericLookup = {}
function isArrayIndex(value) {
	switch (typeof value) {
		case "number":
			return value >= 0 && (value | 0) === value
		case "string": {
			const result = isNumericLookup[value]
			if (result !== void 0) {
				return result
			}
			const length = value.length
			if (length === 0) {
				return (isNumericLookup[value] = false)
			}
			let ch = 0
			for (let i = 0; i < length; ++i) {
				ch = value.charCodeAt(i)
				if (
					(i === 0 && ch === 0x30 && length > 1) /* must not start with 0 */ ||
					ch < 0x30 /* 0 */ ||
					ch > 0x39 /* 9 */
				) {
					return (isNumericLookup[value] = false)
				}
			}
			return (isNumericLookup[value] = true)
		}
		default:
			return false
	}
}

function presentationKeyFromTag(tagName) {
	return `${tagName.toLowerCase()}:presentation`
}
const presentationRegistry = new Map()
/**
 * An API gateway to component presentation features.
 * @public
 */
const ComponentPresentation = Object.freeze({
	/**
	 * Defines a component presentation for an element.
	 * @param tagName - The element name to define the presentation for.
	 * @param presentation - The presentation that will be applied to matching elements.
	 * @param container - The dependency injection container to register the configuration in.
	 * @public
	 */
	define(tagName, presentation, container) {
		const key = presentationKeyFromTag(tagName)
		const existing = presentationRegistry.get(key)
		if (existing === void 0) {
			presentationRegistry.set(key, presentation)
		} else {
			// false indicates that we have more than one presentation
			// registered for a tagName and we must resolve through DI
			presentationRegistry.set(key, false)
		}
		container.register(Registration.instance(key, presentation))
	},
	/**
	 * Finds a component presentation for the specified element name,
	 * searching the DOM hierarchy starting from the provided element.
	 * @param tagName - The name of the element to locate the presentation for.
	 * @param element - The element to begin the search from.
	 * @returns The component presentation or null if none is found.
	 * @public
	 */
	forTag(tagName, element) {
		const key = presentationKeyFromTag(tagName)
		const existing = presentationRegistry.get(key)
		if (existing === false) {
			const container = DI.findResponsibleContainer(element)
			return container.get(key)
		}
		return existing || null
	},
})
/**
 * The default implementation of ComponentPresentation, used by FoundationElement.
 * @public
 */
class DefaultComponentPresentation {
	/**
	 * Creates an instance of DefaultComponentPresentation.
	 * @param template - The template to apply to the element.
	 * @param styles - The styles to apply to the element.
	 * @public
	 */
	constructor(template, styles) {
		this.template = template || null
		this.styles =
			styles === void 0
				? null
				: Array.isArray(styles)
					? ElementStyles.create(styles)
					: styles instanceof ElementStyles
						? styles
						: ElementStyles.create([styles])
	}
	/**
	 * Applies the presentation details to the specified element.
	 * @param element - The element to apply the presentation details to.
	 * @public
	 */
	applyTo(element) {
		const controller = element.$fastController
		if (controller.template === null) {
			controller.template = this.template
		}
		if (controller.styles === null) {
			controller.styles = this.styles
		}
	}
}

/**
 * Defines a foundation element class that:
 * 1. Connects the element to its ComponentPresentation
 * 2. Allows resolving the element template from the instance or ComponentPresentation
 * 3. Allows resolving the element styles from the instance or ComponentPresentation
 *
 * @public
 */
class FoundationElement extends FASTElement {
	constructor() {
		super(...arguments)
		this._presentation = void 0
	}
	/**
	 * A property which resolves the ComponentPresentation instance
	 * for the current component.
	 * @public
	 */
	get $presentation() {
		if (this._presentation === void 0) {
			this._presentation = ComponentPresentation.forTag(this.tagName, this)
		}
		return this._presentation
	}
	templateChanged() {
		if (this.template !== undefined) {
			this.$fastController.template = this.template
		}
	}
	stylesChanged() {
		if (this.styles !== undefined) {
			this.$fastController.styles = this.styles
		}
	}
	/**
	 * The connected callback for this FASTElement.
	 * @remarks
	 * This method is invoked by the platform whenever this FoundationElement
	 * becomes connected to the document.
	 * @public
	 */
	connectedCallback() {
		if (this.$presentation !== null) {
			this.$presentation.applyTo(this)
		}
		super.connectedCallback()
	}
	/**
	 * Defines an element registry function with a set of element definition defaults.
	 * @param elementDefinition - The definition of the element to create the registry
	 * function for.
	 * @public
	 */
	static compose(elementDefinition) {
		return (overrideDefinition = {}) =>
			new FoundationElementRegistry(
				this === FoundationElement ? class extends FoundationElement {} : this,
				elementDefinition,
				overrideDefinition,
			)
	}
}
__decorate$1([observable], FoundationElement.prototype, "template", void 0)
__decorate$1([observable], FoundationElement.prototype, "styles", void 0)
function resolveOption(option, context, definition) {
	if (typeof option === "function") {
		return option(context, definition)
	}
	return option
}
/**
 * Registry capable of defining presentation properties for a DOM Container hierarchy.
 *
 * @internal
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
class FoundationElementRegistry {
	constructor(type, elementDefinition, overrideDefinition) {
		this.type = type
		this.elementDefinition = elementDefinition
		this.overrideDefinition = overrideDefinition
		this.definition = Object.assign(Object.assign({}, this.elementDefinition), this.overrideDefinition)
	}
	register(container, context) {
		const definition = this.definition
		const overrideDefinition = this.overrideDefinition
		const prefix = definition.prefix || context.elementPrefix
		const name = `${prefix}-${definition.baseName}`
		context.tryDefineElement({
			name,
			type: this.type,
			baseClass: this.elementDefinition.baseClass,
			callback: (x) => {
				const presentation = new DefaultComponentPresentation(
					resolveOption(definition.template, x, definition),
					resolveOption(definition.styles, x, definition),
				)
				x.definePresentation(presentation)
				let shadowOptions = resolveOption(definition.shadowOptions, x, definition)
				if (x.shadowRootMode) {
					// If the design system has overridden the shadow root mode, we need special handling.
					if (shadowOptions) {
						// If there are shadow options present in the definition, then
						// either the component itself has specified an option or the
						// registry function has overridden it.
						if (!overrideDefinition.shadowOptions) {
							// There were shadow options provided by the component and not overridden by
							// the registry.
							shadowOptions.mode = x.shadowRootMode
						}
					} else if (shadowOptions !== null) {
						// If the component author did not provide shadow options,
						// and did not null them out (light dom opt-in) then they
						// were relying on the FASTElement default. So, if the
						// design system provides a mode, we need to create the options
						// to override the default.
						shadowOptions = {
							mode: x.shadowRootMode,
						}
					}
				}
				x.defineElement({
					elementOptions: resolveOption(definition.elementOptions, x, definition),
					shadowOptions,
					attributes: resolveOption(definition.attributes, x, definition),
				})
			},
		})
	}
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * Apply mixins to a constructor.
 * Sourced from {@link https://www.typescriptlang.org/docs/handbook/mixins.html | TypeScript Documentation }.
 * @public
 */
function applyMixins(derivedCtor, ...baseCtors) {
	const derivedAttributes = AttributeConfiguration.locate(derivedCtor)
	baseCtors.forEach((baseCtor) => {
		Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
			if (name !== "constructor") {
				Object.defineProperty(
					derivedCtor.prototype,
					name /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */,
					Object.getOwnPropertyDescriptor(baseCtor.prototype, name),
				)
			}
		})
		const baseAttributes = AttributeConfiguration.locate(baseCtor)
		baseAttributes.forEach((x) => derivedAttributes.push(x))
	})
}

/**
 * Standard orientation values
 */
const Orientation = {
	horizontal: "horizontal",
	vertical: "vertical",
}

/**
 * Returns the index of the last element in the array where predicate is true, and -1 otherwise.
 *
 * @param array - the array to test
 * @param predicate - find calls predicate once for each element of the array, in descending order, until it finds one where predicate returns true. If such an element is found, findLastIndex immediately returns that element index. Otherwise, findIndex returns -1.
 */
function findLastIndex(array, predicate) {
	let k = array.length
	while (k--) {
		if (predicate(array[k], k, array)) {
			return k
		}
	}
	return -1
}

/**
 * Checks if the DOM is available to access and use
 */
function canUseDOM() {
	return !!(typeof window !== "undefined" && window.document && window.document.createElement)
}

/**
 * A test that ensures that all arguments are HTML Elements
 */
function isHTMLElement(...args) {
	return args.every((arg) => arg instanceof HTMLElement)
}
/**
 * Returns the nonce used in the page, if any.
 *
 * Based on https://github.com/cssinjs/jss/blob/master/packages/jss/src/DomRenderer.js
 */
function getNonce() {
	const node = document.querySelector('meta[property="csp-nonce"]')
	if (node) {
		return node.getAttribute("content")
	} else {
		return null
	}
}
/**
 * Test if the document supports :focus-visible
 */
let _canUseFocusVisible
function canUseFocusVisible() {
	if (typeof _canUseFocusVisible === "boolean") {
		return _canUseFocusVisible
	}
	if (!canUseDOM()) {
		_canUseFocusVisible = false
		return _canUseFocusVisible
	}
	// Check to see if the document supports the focus-visible element
	const styleElement = document.createElement("style")
	// If nonces are present on the page, use it when creating the style element
	// to test focus-visible support.
	const styleNonce = getNonce()
	if (styleNonce !== null) {
		styleElement.setAttribute("nonce", styleNonce)
	}
	document.head.appendChild(styleElement)
	try {
		styleElement.sheet.insertRule("foo:focus-visible {color:inherit}", 0)
		_canUseFocusVisible = true
	} catch (e) {
		_canUseFocusVisible = false
	} finally {
		document.head.removeChild(styleElement)
	}
	return _canUseFocusVisible
}

/**
 * This set of exported strings reference https://developer.mozilla.org/en-US/docs/Web/Events
 * and should include all non-deprecated and non-experimental Standard events
 */
const eventFocus = "focus"
const eventFocusIn = "focusin"
const eventFocusOut = "focusout"
const eventKeyDown = "keydown"

/**
 * Key Code values
 * @deprecated - KeyCodes are deprecated, use individual string key exports
 */
var KeyCodes
;(function (KeyCodes) {
	KeyCodes[(KeyCodes["alt"] = 18)] = "alt"
	KeyCodes[(KeyCodes["arrowDown"] = 40)] = "arrowDown"
	KeyCodes[(KeyCodes["arrowLeft"] = 37)] = "arrowLeft"
	KeyCodes[(KeyCodes["arrowRight"] = 39)] = "arrowRight"
	KeyCodes[(KeyCodes["arrowUp"] = 38)] = "arrowUp"
	KeyCodes[(KeyCodes["back"] = 8)] = "back"
	KeyCodes[(KeyCodes["backSlash"] = 220)] = "backSlash"
	KeyCodes[(KeyCodes["break"] = 19)] = "break"
	KeyCodes[(KeyCodes["capsLock"] = 20)] = "capsLock"
	KeyCodes[(KeyCodes["closeBracket"] = 221)] = "closeBracket"
	KeyCodes[(KeyCodes["colon"] = 186)] = "colon"
	KeyCodes[(KeyCodes["colon2"] = 59)] = "colon2"
	KeyCodes[(KeyCodes["comma"] = 188)] = "comma"
	KeyCodes[(KeyCodes["ctrl"] = 17)] = "ctrl"
	KeyCodes[(KeyCodes["delete"] = 46)] = "delete"
	KeyCodes[(KeyCodes["end"] = 35)] = "end"
	KeyCodes[(KeyCodes["enter"] = 13)] = "enter"
	KeyCodes[(KeyCodes["equals"] = 187)] = "equals"
	KeyCodes[(KeyCodes["equals2"] = 61)] = "equals2"
	KeyCodes[(KeyCodes["equals3"] = 107)] = "equals3"
	KeyCodes[(KeyCodes["escape"] = 27)] = "escape"
	KeyCodes[(KeyCodes["forwardSlash"] = 191)] = "forwardSlash"
	KeyCodes[(KeyCodes["function1"] = 112)] = "function1"
	KeyCodes[(KeyCodes["function10"] = 121)] = "function10"
	KeyCodes[(KeyCodes["function11"] = 122)] = "function11"
	KeyCodes[(KeyCodes["function12"] = 123)] = "function12"
	KeyCodes[(KeyCodes["function2"] = 113)] = "function2"
	KeyCodes[(KeyCodes["function3"] = 114)] = "function3"
	KeyCodes[(KeyCodes["function4"] = 115)] = "function4"
	KeyCodes[(KeyCodes["function5"] = 116)] = "function5"
	KeyCodes[(KeyCodes["function6"] = 117)] = "function6"
	KeyCodes[(KeyCodes["function7"] = 118)] = "function7"
	KeyCodes[(KeyCodes["function8"] = 119)] = "function8"
	KeyCodes[(KeyCodes["function9"] = 120)] = "function9"
	KeyCodes[(KeyCodes["home"] = 36)] = "home"
	KeyCodes[(KeyCodes["insert"] = 45)] = "insert"
	KeyCodes[(KeyCodes["menu"] = 93)] = "menu"
	KeyCodes[(KeyCodes["minus"] = 189)] = "minus"
	KeyCodes[(KeyCodes["minus2"] = 109)] = "minus2"
	KeyCodes[(KeyCodes["numLock"] = 144)] = "numLock"
	KeyCodes[(KeyCodes["numPad0"] = 96)] = "numPad0"
	KeyCodes[(KeyCodes["numPad1"] = 97)] = "numPad1"
	KeyCodes[(KeyCodes["numPad2"] = 98)] = "numPad2"
	KeyCodes[(KeyCodes["numPad3"] = 99)] = "numPad3"
	KeyCodes[(KeyCodes["numPad4"] = 100)] = "numPad4"
	KeyCodes[(KeyCodes["numPad5"] = 101)] = "numPad5"
	KeyCodes[(KeyCodes["numPad6"] = 102)] = "numPad6"
	KeyCodes[(KeyCodes["numPad7"] = 103)] = "numPad7"
	KeyCodes[(KeyCodes["numPad8"] = 104)] = "numPad8"
	KeyCodes[(KeyCodes["numPad9"] = 105)] = "numPad9"
	KeyCodes[(KeyCodes["numPadDivide"] = 111)] = "numPadDivide"
	KeyCodes[(KeyCodes["numPadDot"] = 110)] = "numPadDot"
	KeyCodes[(KeyCodes["numPadMinus"] = 109)] = "numPadMinus"
	KeyCodes[(KeyCodes["numPadMultiply"] = 106)] = "numPadMultiply"
	KeyCodes[(KeyCodes["numPadPlus"] = 107)] = "numPadPlus"
	KeyCodes[(KeyCodes["openBracket"] = 219)] = "openBracket"
	KeyCodes[(KeyCodes["pageDown"] = 34)] = "pageDown"
	KeyCodes[(KeyCodes["pageUp"] = 33)] = "pageUp"
	KeyCodes[(KeyCodes["period"] = 190)] = "period"
	KeyCodes[(KeyCodes["print"] = 44)] = "print"
	KeyCodes[(KeyCodes["quote"] = 222)] = "quote"
	KeyCodes[(KeyCodes["scrollLock"] = 145)] = "scrollLock"
	KeyCodes[(KeyCodes["shift"] = 16)] = "shift"
	KeyCodes[(KeyCodes["space"] = 32)] = "space"
	KeyCodes[(KeyCodes["tab"] = 9)] = "tab"
	KeyCodes[(KeyCodes["tilde"] = 192)] = "tilde"
	KeyCodes[(KeyCodes["windowsLeft"] = 91)] = "windowsLeft"
	KeyCodes[(KeyCodes["windowsOpera"] = 219)] = "windowsOpera"
	KeyCodes[(KeyCodes["windowsRight"] = 92)] = "windowsRight"
})(KeyCodes || (KeyCodes = {}))
/**
 * String values for use with KeyboardEvent.key
 */
const keyArrowDown = "ArrowDown"
const keyArrowLeft = "ArrowLeft"
const keyArrowRight = "ArrowRight"
const keyArrowUp = "ArrowUp"
const keyEnter = "Enter"
const keyEscape = "Escape"
const keyHome = "Home"
const keyEnd = "End"
const keyFunction2 = "F2"
const keyPageDown = "PageDown"
const keyPageUp = "PageUp"
const keySpace = " "
const keyTab = "Tab"
const ArrowKeys = {
	ArrowDown: keyArrowDown,
	ArrowLeft: keyArrowLeft,
	ArrowRight: keyArrowRight,
	ArrowUp: keyArrowUp,
}

/**
 * Expose ltr and rtl strings
 */
var Direction
;(function (Direction) {
	Direction["ltr"] = "ltr"
	Direction["rtl"] = "rtl"
})(Direction || (Direction = {}))

/**
 * This method keeps a given value within the bounds of a min and max value. If the value
 * is larger than the max, the minimum value will be returned. If the value is smaller than the minimum,
 * the maximum will be returned. Otherwise, the value is returned un-changed.
 */
/**
 * Ensures that a value is between a min and max value. If value is lower than min, min will be returned.
 * If value is greater than max, max will be returned.
 */
function limit(min, max, value) {
	return Math.min(Math.max(value, min), max)
}
/**
 * Determines if a number value is within a specified range.
 *
 * @param value - the value to check
 * @param min - the range start
 * @param max - the range end
 */
function inRange(value, min, max = 0) {
	;[min, max] = [min, max].sort((a, b) => a - b)
	return min <= value && value < max
}

let uniqueIdCounter = 0
/**
 * Generates a unique ID based on incrementing a counter.
 */
function uniqueId(prefix = "") {
	return `${prefix}${uniqueIdCounter++}`
}

/**
 * The template for the {@link @microsoft/fast-foundation#(Anchor:class)} component.
 * @public
 */
const anchorTemplate = (context, definition) =>
	html`<a
		class="control"
		part="control"
		download="${(x) => x.download}"
		href="${(x) => x.href}"
		hreflang="${(x) => x.hreflang}"
		ping="${(x) => x.ping}"
		referrerpolicy="${(x) => x.referrerpolicy}"
		rel="${(x) => x.rel}"
		target="${(x) => x.target}"
		type="${(x) => x.type}"
		aria-atomic="${(x) => x.ariaAtomic}"
		aria-busy="${(x) => x.ariaBusy}"
		aria-controls="${(x) => x.ariaControls}"
		aria-current="${(x) => x.ariaCurrent}"
		aria-describedby="${(x) => x.ariaDescribedby}"
		aria-details="${(x) => x.ariaDetails}"
		aria-disabled="${(x) => x.ariaDisabled}"
		aria-errormessage="${(x) => x.ariaErrormessage}"
		aria-expanded="${(x) => x.ariaExpanded}"
		aria-flowto="${(x) => x.ariaFlowto}"
		aria-haspopup="${(x) => x.ariaHaspopup}"
		aria-hidden="${(x) => x.ariaHidden}"
		aria-invalid="${(x) => x.ariaInvalid}"
		aria-keyshortcuts="${(x) => x.ariaKeyshortcuts}"
		aria-label="${(x) => x.ariaLabel}"
		aria-labelledby="${(x) => x.ariaLabelledby}"
		aria-live="${(x) => x.ariaLive}"
		aria-owns="${(x) => x.ariaOwns}"
		aria-relevant="${(x) => x.ariaRelevant}"
		aria-roledescription="${(x) => x.ariaRoledescription}"
		${ref("control")}
		>${startSlotTemplate(context, definition)}<span class="content" part="content"
			><slot ${slotted("defaultSlottedContent")}></slot></span
		>${endSlotTemplate(context, definition)}</a
	>`

/**
 * Some states and properties are applicable to all host language elements regardless of whether a role is applied.
 * The following global states and properties are supported by all roles and by all base markup elements.
 * {@link https://www.w3.org/TR/wai-aria-1.1/#global_states}
 *
 * This is intended to be used as a mixin. Be sure you extend FASTElement.
 *
 * @public
 */
class ARIAGlobalStatesAndProperties {}
__decorate$1(
	[
		attr({
			attribute: "aria-atomic",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaAtomic",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-busy",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaBusy",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-controls",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaControls",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-current",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaCurrent",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-describedby",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaDescribedby",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-details",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaDetails",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-disabled",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaDisabled",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-errormessage",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaErrormessage",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-flowto",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaFlowto",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-haspopup",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaHaspopup",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-hidden",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaHidden",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-invalid",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaInvalid",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-keyshortcuts",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaKeyshortcuts",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-label",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaLabel",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-labelledby",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaLabelledby",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-live",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaLive",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-owns",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaOwns",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-relevant",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaRelevant",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-roledescription",
		}),
	],
	ARIAGlobalStatesAndProperties.prototype,
	"ariaRoledescription",
	void 0,
)

/**
 * An Anchor Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a | <a> element }.
 *
 * @slot start - Content which can be provided before the anchor content
 * @slot end - Content which can be provided after the anchor content
 * @slot - The default slot for anchor content
 * @csspart control - The anchor element
 * @csspart content - The element wrapping anchor content
 *
 * @public
 */
class Anchor extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * Overrides the focus call for where delegatesFocus is unsupported.
		 * This check works for Chrome, Edge Chromium, FireFox, and Safari
		 * Relevant PR on the Firefox browser: https://phabricator.services.mozilla.com/D123858
		 */
		this.handleUnsupportedDelegatesFocus = () => {
			var _a
			// Check to see if delegatesFocus is supported
			if (
				window.ShadowRoot &&
				!window.ShadowRoot.prototype.hasOwnProperty("delegatesFocus") &&
				((_a = this.$fastController.definition.shadowOptions) === null || _a === void 0 ? void 0 : _a.delegatesFocus)
			) {
				this.focus = () => {
					var _a
					;(_a = this.control) === null || _a === void 0 ? void 0 : _a.focus()
				}
			}
		}
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		this.handleUnsupportedDelegatesFocus()
	}
}
__decorate$1([attr], Anchor.prototype, "download", void 0)
__decorate$1([attr], Anchor.prototype, "href", void 0)
__decorate$1([attr], Anchor.prototype, "hreflang", void 0)
__decorate$1([attr], Anchor.prototype, "ping", void 0)
__decorate$1([attr], Anchor.prototype, "referrerpolicy", void 0)
__decorate$1([attr], Anchor.prototype, "rel", void 0)
__decorate$1([attr], Anchor.prototype, "target", void 0)
__decorate$1([attr], Anchor.prototype, "type", void 0)
__decorate$1([observable], Anchor.prototype, "defaultSlottedContent", void 0)
/**
 * Includes ARIA states and properties relating to the ARIA link role
 *
 * @public
 */
class DelegatesARIALink {}
__decorate$1(
	[
		attr({
			attribute: "aria-expanded",
		}),
	],
	DelegatesARIALink.prototype,
	"ariaExpanded",
	void 0,
)
applyMixins(DelegatesARIALink, ARIAGlobalStatesAndProperties)
applyMixins(Anchor, StartEnd, DelegatesARIALink)

/**
 * a method to determine the current localization direction of the view
 * @param rootNode - the HTMLElement to begin the query from, usually "this" when used in a component controller
 * @public
 */
const getDirection = (rootNode) => {
	const dirNode = rootNode.closest("[dir]")
	return dirNode !== null && dirNode.dir === "rtl" ? Direction.rtl : Direction.ltr
}

/**
 * The template for the {@link @microsoft/fast-foundation#Badge} component.
 * @public
 */
const badgeTemplate = (context, definition) =>
	html`<template class="${(x) => (x.circular ? "circular" : "")}"
		><div class="control" part="control" style="${(x) => x.generateBadgeStyle()}"><slot></slot></div
	></template>`

/**
 * A Badge Custom HTML Element.
 * @slot - The default slot for the badge
 * @csspart control - The element representing the badge, which wraps the default slot
 *
 * @public
 */
class Badge$1 extends FoundationElement {
	constructor() {
		super(...arguments)
		this.generateBadgeStyle = () => {
			if (!this.fill && !this.color) {
				return
			}
			const fill = `background-color: var(--badge-fill-${this.fill});`
			const color = `color: var(--badge-color-${this.color});`
			if (this.fill && !this.color) {
				return fill
			} else if (this.color && !this.fill) {
				return color
			} else {
				return `${color} ${fill}`
			}
		}
	}
}
__decorate$1(
	[
		attr({
			attribute: "fill",
		}),
	],
	Badge$1.prototype,
	"fill",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "color",
		}),
	],
	Badge$1.prototype,
	"color",
	void 0,
)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	Badge$1.prototype,
	"circular",
	void 0,
)

/**
 * The template for the {@link @microsoft/fast-foundation#(Button:class)} component.
 * @public
 */
const buttonTemplate = (context, definition) =>
	html`<button
		class="control"
		part="control"
		?autofocus="${(x) => x.autofocus}"
		?disabled="${(x) => x.disabled}"
		form="${(x) => x.formId}"
		formaction="${(x) => x.formaction}"
		formenctype="${(x) => x.formenctype}"
		formmethod="${(x) => x.formmethod}"
		formnovalidate="${(x) => x.formnovalidate}"
		formtarget="${(x) => x.formtarget}"
		name="${(x) => x.name}"
		type="${(x) => x.type}"
		value="${(x) => x.value}"
		aria-atomic="${(x) => x.ariaAtomic}"
		aria-busy="${(x) => x.ariaBusy}"
		aria-controls="${(x) => x.ariaControls}"
		aria-current="${(x) => x.ariaCurrent}"
		aria-describedby="${(x) => x.ariaDescribedby}"
		aria-details="${(x) => x.ariaDetails}"
		aria-disabled="${(x) => x.ariaDisabled}"
		aria-errormessage="${(x) => x.ariaErrormessage}"
		aria-expanded="${(x) => x.ariaExpanded}"
		aria-flowto="${(x) => x.ariaFlowto}"
		aria-haspopup="${(x) => x.ariaHaspopup}"
		aria-hidden="${(x) => x.ariaHidden}"
		aria-invalid="${(x) => x.ariaInvalid}"
		aria-keyshortcuts="${(x) => x.ariaKeyshortcuts}"
		aria-label="${(x) => x.ariaLabel}"
		aria-labelledby="${(x) => x.ariaLabelledby}"
		aria-live="${(x) => x.ariaLive}"
		aria-owns="${(x) => x.ariaOwns}"
		aria-pressed="${(x) => x.ariaPressed}"
		aria-relevant="${(x) => x.ariaRelevant}"
		aria-roledescription="${(x) => x.ariaRoledescription}"
		${ref("control")}>
		${startSlotTemplate(context, definition)}<span class="content" part="content"
			><slot ${slotted("defaultSlottedContent")}></slot></span
		>${endSlotTemplate(context, definition)}
	</button>`

const proxySlotName = "form-associated-proxy"
const ElementInternalsKey = "ElementInternals"
/**
 * @alpha
 */
const supportsElementInternals = ElementInternalsKey in window && "setFormValue" in window[ElementInternalsKey].prototype
const InternalsMap = new WeakMap()
/**
 * Base function for providing Custom Element Form Association.
 *
 * @alpha
 */
function FormAssociated(BaseCtor) {
	const C = class extends BaseCtor {
		constructor(...args) {
			super(...args)
			/**
			 * Track whether the value has been changed from the initial value
			 */
			this.dirtyValue = false
			/**
			 * Sets the element's disabled state. A disabled element will not be included during form submission.
			 *
			 * @remarks
			 * HTML Attribute: disabled
			 */
			this.disabled = false
			/**
			 * These are events that are still fired by the proxy
			 * element based on user / programmatic interaction.
			 *
			 * The proxy implementation should be transparent to
			 * the app author, so block these events from emitting.
			 */
			this.proxyEventsToBlock = ["change", "click"]
			this.proxyInitialized = false
			this.required = false
			this.initialValue = this.initialValue || ""
			if (!this.elementInternals) {
				// When elementInternals is not supported, formResetCallback is
				// bound to an event listener, so ensure the handler's `this`
				// context is correct.
				this.formResetCallback = this.formResetCallback.bind(this)
			}
		}
		/**
		 * Must evaluate to true to enable elementInternals.
		 * Feature detects API support and resolve respectively
		 *
		 * @internal
		 */
		static get formAssociated() {
			return supportsElementInternals
		}
		/**
		 * Returns the validity state of the element
		 *
		 * @alpha
		 */
		get validity() {
			return this.elementInternals ? this.elementInternals.validity : this.proxy.validity
		}
		/**
		 * Retrieve a reference to the associated form.
		 * Returns null if not associated to any form.
		 *
		 * @alpha
		 */
		get form() {
			return this.elementInternals ? this.elementInternals.form : this.proxy.form
		}
		/**
		 * Retrieve the localized validation message,
		 * or custom validation message if set.
		 *
		 * @alpha
		 */
		get validationMessage() {
			return this.elementInternals ? this.elementInternals.validationMessage : this.proxy.validationMessage
		}
		/**
		 * Whether the element will be validated when the
		 * form is submitted
		 */
		get willValidate() {
			return this.elementInternals ? this.elementInternals.willValidate : this.proxy.willValidate
		}
		/**
		 * A reference to all associated label elements
		 */
		get labels() {
			if (this.elementInternals) {
				return Object.freeze(Array.from(this.elementInternals.labels))
			} else if (this.proxy instanceof HTMLElement && this.proxy.ownerDocument && this.id) {
				// Labels associated by wrapping the element: <label><custom-element></custom-element></label>
				const parentLabels = this.proxy.labels
				// Labels associated using the `for` attribute
				const forLabels = Array.from(this.proxy.getRootNode().querySelectorAll(`[for='${this.id}']`))
				const labels = parentLabels ? forLabels.concat(Array.from(parentLabels)) : forLabels
				return Object.freeze(labels)
			} else {
				return emptyArray
			}
		}
		/**
		 * Invoked when the `value` property changes
		 * @param previous - the previous value
		 * @param next - the new value
		 *
		 * @remarks
		 * If elements extending `FormAssociated` implement a `valueChanged` method
		 * They must be sure to invoke `super.valueChanged(previous, next)` to ensure
		 * proper functioning of `FormAssociated`
		 */
		valueChanged(previous, next) {
			this.dirtyValue = true
			if (this.proxy instanceof HTMLElement) {
				this.proxy.value = this.value
			}
			this.currentValue = this.value
			this.setFormValue(this.value)
			this.validate()
		}
		currentValueChanged() {
			this.value = this.currentValue
		}
		/**
		 * Invoked when the `initialValue` property changes
		 *
		 * @param previous - the previous value
		 * @param next - the new value
		 *
		 * @remarks
		 * If elements extending `FormAssociated` implement a `initialValueChanged` method
		 * They must be sure to invoke `super.initialValueChanged(previous, next)` to ensure
		 * proper functioning of `FormAssociated`
		 */
		initialValueChanged(previous, next) {
			// If the value is clean and the component is connected to the DOM
			// then set value equal to the attribute value.
			if (!this.dirtyValue) {
				this.value = this.initialValue
				this.dirtyValue = false
			}
		}
		/**
		 * Invoked when the `disabled` property changes
		 *
		 * @param previous - the previous value
		 * @param next - the new value
		 *
		 * @remarks
		 * If elements extending `FormAssociated` implement a `disabledChanged` method
		 * They must be sure to invoke `super.disabledChanged(previous, next)` to ensure
		 * proper functioning of `FormAssociated`
		 */
		disabledChanged(previous, next) {
			if (this.proxy instanceof HTMLElement) {
				this.proxy.disabled = this.disabled
			}
			DOM.queueUpdate(() => this.classList.toggle("disabled", this.disabled))
		}
		/**
		 * Invoked when the `name` property changes
		 *
		 * @param previous - the previous value
		 * @param next - the new value
		 *
		 * @remarks
		 * If elements extending `FormAssociated` implement a `nameChanged` method
		 * They must be sure to invoke `super.nameChanged(previous, next)` to ensure
		 * proper functioning of `FormAssociated`
		 */
		nameChanged(previous, next) {
			if (this.proxy instanceof HTMLElement) {
				this.proxy.name = this.name
			}
		}
		/**
		 * Invoked when the `required` property changes
		 *
		 * @param previous - the previous value
		 * @param next - the new value
		 *
		 * @remarks
		 * If elements extending `FormAssociated` implement a `requiredChanged` method
		 * They must be sure to invoke `super.requiredChanged(previous, next)` to ensure
		 * proper functioning of `FormAssociated`
		 */
		requiredChanged(prev, next) {
			if (this.proxy instanceof HTMLElement) {
				this.proxy.required = this.required
			}
			DOM.queueUpdate(() => this.classList.toggle("required", this.required))
			this.validate()
		}
		/**
		 * The element internals object. Will only exist
		 * in browsers supporting the attachInternals API
		 */
		get elementInternals() {
			if (!supportsElementInternals) {
				return null
			}
			let internals = InternalsMap.get(this)
			if (!internals) {
				internals = this.attachInternals()
				InternalsMap.set(this, internals)
			}
			return internals
		}
		/**
		 * @internal
		 */
		connectedCallback() {
			super.connectedCallback()
			this.addEventListener("keypress", this._keypressHandler)
			if (!this.value) {
				this.value = this.initialValue
				this.dirtyValue = false
			}
			if (!this.elementInternals) {
				this.attachProxy()
				if (this.form) {
					this.form.addEventListener("reset", this.formResetCallback)
				}
			}
		}
		/**
		 * @internal
		 */
		disconnectedCallback() {
			super.disconnectedCallback()
			this.proxyEventsToBlock.forEach((name) => this.proxy.removeEventListener(name, this.stopPropagation))
			if (!this.elementInternals && this.form) {
				this.form.removeEventListener("reset", this.formResetCallback)
			}
		}
		/**
		 * Return the current validity of the element.
		 */
		checkValidity() {
			return this.elementInternals ? this.elementInternals.checkValidity() : this.proxy.checkValidity()
		}
		/**
		 * Return the current validity of the element.
		 * If false, fires an invalid event at the element.
		 */
		reportValidity() {
			return this.elementInternals ? this.elementInternals.reportValidity() : this.proxy.reportValidity()
		}
		/**
		 * Set the validity of the control. In cases when the elementInternals object is not
		 * available (and the proxy element is used to report validity), this function will
		 * do nothing unless a message is provided, at which point the setCustomValidity method
		 * of the proxy element will be invoked with the provided message.
		 * @param flags - Validity flags
		 * @param message - Optional message to supply
		 * @param anchor - Optional element used by UA to display an interactive validation UI
		 */
		setValidity(flags, message, anchor) {
			if (this.elementInternals) {
				this.elementInternals.setValidity(flags, message, anchor)
			} else if (typeof message === "string") {
				this.proxy.setCustomValidity(message)
			}
		}
		/**
		 * Invoked when a connected component's form or fieldset has its disabled
		 * state changed.
		 * @param disabled - the disabled value of the form / fieldset
		 */
		formDisabledCallback(disabled) {
			this.disabled = disabled
		}
		formResetCallback() {
			this.value = this.initialValue
			this.dirtyValue = false
		}
		/**
		 * Attach the proxy element to the DOM
		 */
		attachProxy() {
			var _a
			if (!this.proxyInitialized) {
				this.proxyInitialized = true
				this.proxy.style.display = "none"
				this.proxyEventsToBlock.forEach((name) => this.proxy.addEventListener(name, this.stopPropagation))
				// These are typically mapped to the proxy during
				// property change callbacks, but during initialization
				// on the initial call of the callback, the proxy is
				// still undefined. We should find a better way to address this.
				this.proxy.disabled = this.disabled
				this.proxy.required = this.required
				if (typeof this.name === "string") {
					this.proxy.name = this.name
				}
				if (typeof this.value === "string") {
					this.proxy.value = this.value
				}
				this.proxy.setAttribute("slot", proxySlotName)
				this.proxySlot = document.createElement("slot")
				this.proxySlot.setAttribute("name", proxySlotName)
			}
			;(_a = this.shadowRoot) === null || _a === void 0 ? void 0 : _a.appendChild(this.proxySlot)
			this.appendChild(this.proxy)
		}
		/**
		 * Detach the proxy element from the DOM
		 */
		detachProxy() {
			var _a
			this.removeChild(this.proxy)
			;(_a = this.shadowRoot) === null || _a === void 0 ? void 0 : _a.removeChild(this.proxySlot)
		}
		/** {@inheritDoc (FormAssociated:interface).validate} */
		validate(anchor) {
			if (this.proxy instanceof HTMLElement) {
				this.setValidity(this.proxy.validity, this.proxy.validationMessage, anchor)
			}
		}
		/**
		 * Associates the provided value (and optional state) with the parent form.
		 * @param value - The value to set
		 * @param state - The state object provided to during session restores and when autofilling.
		 */
		setFormValue(value, state) {
			if (this.elementInternals) {
				this.elementInternals.setFormValue(value, state || value)
			}
		}
		_keypressHandler(e) {
			switch (e.key) {
				case keyEnter:
					if (this.form instanceof HTMLFormElement) {
						// Implicit submission
						const defaultButton = this.form.querySelector("[type=submit]")
						defaultButton === null || defaultButton === void 0 ? void 0 : defaultButton.click()
					}
					break
			}
		}
		/**
		 * Used to stop propagation of proxy element events
		 * @param e - Event object
		 */
		stopPropagation(e) {
			e.stopPropagation()
		}
	}
	attr({
		mode: "boolean",
	})(C.prototype, "disabled")
	attr({
		mode: "fromView",
		attribute: "value",
	})(C.prototype, "initialValue")
	attr({
		attribute: "current-value",
	})(C.prototype, "currentValue")
	attr(C.prototype, "name")
	attr({
		mode: "boolean",
	})(C.prototype, "required")
	observable(C.prototype, "value")
	return C
}
/**
 * @alpha
 */
function CheckableFormAssociated(BaseCtor) {
	class C extends FormAssociated(BaseCtor) {}
	class D extends C {
		constructor(...args) {
			super(args)
			/**
			 * Tracks whether the "checked" property has been changed.
			 * This is necessary to provide consistent behavior with
			 * normal input checkboxes
			 */
			this.dirtyChecked = false
			/**
			 * Provides the default checkedness of the input element
			 * Passed down to proxy
			 *
			 * @public
			 * @remarks
			 * HTML Attribute: checked
			 */
			this.checkedAttribute = false
			/**
			 * The checked state of the control.
			 *
			 * @public
			 */
			this.checked = false
			// Re-initialize dirtyChecked because initialization of other values
			// causes it to become true
			this.dirtyChecked = false
		}
		checkedAttributeChanged() {
			this.defaultChecked = this.checkedAttribute
		}
		/**
		 * @internal
		 */
		defaultCheckedChanged() {
			if (!this.dirtyChecked) {
				// Setting this.checked will cause us to enter a dirty state,
				// but if we are clean when defaultChecked is changed, we want to stay
				// in a clean state, so reset this.dirtyChecked
				this.checked = this.defaultChecked
				this.dirtyChecked = false
			}
		}
		checkedChanged(prev, next) {
			if (!this.dirtyChecked) {
				this.dirtyChecked = true
			}
			this.currentChecked = this.checked
			this.updateForm()
			if (this.proxy instanceof HTMLInputElement) {
				this.proxy.checked = this.checked
			}
			if (prev !== undefined) {
				this.$emit("change")
			}
			this.validate()
		}
		currentCheckedChanged(prev, next) {
			this.checked = this.currentChecked
		}
		updateForm() {
			const value = this.checked ? this.value : null
			this.setFormValue(value, value)
		}
		connectedCallback() {
			super.connectedCallback()
			this.updateForm()
		}
		formResetCallback() {
			super.formResetCallback()
			this.checked = !!this.checkedAttribute
			this.dirtyChecked = false
		}
	}
	attr({
		attribute: "checked",
		mode: "boolean",
	})(D.prototype, "checkedAttribute")
	attr({
		attribute: "current-checked",
		converter: booleanConverter,
	})(D.prototype, "currentChecked")
	observable(D.prototype, "defaultChecked")
	observable(D.prototype, "checked")
	return D
}

class _Button extends FoundationElement {}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Button:class)} component.
 *
 * @internal
 */
class FormAssociatedButton extends FormAssociated(_Button) {
	constructor() {
		super(...arguments)
		this.proxy = document.createElement("input")
	}
}

/**
 * A Button Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element }.
 *
 * @slot start - Content which can be provided before the button content
 * @slot end - Content which can be provided after the button content
 * @slot - The default slot for button content
 * @csspart control - The button element
 * @csspart content - The element wrapping button content
 *
 * @public
 */
class Button$1 extends FormAssociatedButton {
	constructor() {
		super(...arguments)
		/**
		 * Prevent events to propagate if disabled and has no slotted content wrapped in HTML elements
		 * @internal
		 */
		this.handleClick = (e) => {
			var _a
			if (this.disabled && ((_a = this.defaultSlottedContent) === null || _a === void 0 ? void 0 : _a.length) <= 1) {
				e.stopPropagation()
			}
		}
		/**
		 * Submits the parent form
		 */
		this.handleSubmission = () => {
			if (!this.form) {
				return
			}
			const attached = this.proxy.isConnected
			if (!attached) {
				this.attachProxy()
			}
			// Browser support for requestSubmit is not comprehensive
			// so click the proxy if it isn't supported
			typeof this.form.requestSubmit === "function" ? this.form.requestSubmit(this.proxy) : this.proxy.click()
			if (!attached) {
				this.detachProxy()
			}
		}
		/**
		 * Resets the parent form
		 */
		this.handleFormReset = () => {
			var _a
			;(_a = this.form) === null || _a === void 0 ? void 0 : _a.reset()
		}
		/**
		 * Overrides the focus call for where delegatesFocus is unsupported.
		 * This check works for Chrome, Edge Chromium, FireFox, and Safari
		 * Relevant PR on the Firefox browser: https://phabricator.services.mozilla.com/D123858
		 */
		this.handleUnsupportedDelegatesFocus = () => {
			var _a
			// Check to see if delegatesFocus is supported
			if (
				window.ShadowRoot &&
				!window.ShadowRoot.prototype.hasOwnProperty("delegatesFocus") &&
				((_a = this.$fastController.definition.shadowOptions) === null || _a === void 0 ? void 0 : _a.delegatesFocus)
			) {
				this.focus = () => {
					this.control.focus()
				}
			}
		}
	}
	formactionChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.formAction = this.formaction
		}
	}
	formenctypeChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.formEnctype = this.formenctype
		}
	}
	formmethodChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.formMethod = this.formmethod
		}
	}
	formnovalidateChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.formNoValidate = this.formnovalidate
		}
	}
	formtargetChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.formTarget = this.formtarget
		}
	}
	typeChanged(previous, next) {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.type = this.type
		}
		next === "submit" && this.addEventListener("click", this.handleSubmission)
		previous === "submit" && this.removeEventListener("click", this.handleSubmission)
		next === "reset" && this.addEventListener("click", this.handleFormReset)
		previous === "reset" && this.removeEventListener("click", this.handleFormReset)
	}
	/** {@inheritDoc (FormAssociated:interface).validate} */
	validate() {
		super.validate(this.control)
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		var _a
		super.connectedCallback()
		this.proxy.setAttribute("type", this.type)
		this.handleUnsupportedDelegatesFocus()
		const elements = Array.from((_a = this.control) === null || _a === void 0 ? void 0 : _a.children)
		if (elements) {
			elements.forEach((span) => {
				span.addEventListener("click", this.handleClick)
			})
		}
	}
	/**
	 * @internal
	 */
	disconnectedCallback() {
		var _a
		super.disconnectedCallback()
		const elements = Array.from((_a = this.control) === null || _a === void 0 ? void 0 : _a.children)
		if (elements) {
			elements.forEach((span) => {
				span.removeEventListener("click", this.handleClick)
			})
		}
	}
}
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	Button$1.prototype,
	"autofocus",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "form",
		}),
	],
	Button$1.prototype,
	"formId",
	void 0,
)
__decorate$1([attr], Button$1.prototype, "formaction", void 0)
__decorate$1([attr], Button$1.prototype, "formenctype", void 0)
__decorate$1([attr], Button$1.prototype, "formmethod", void 0)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	Button$1.prototype,
	"formnovalidate",
	void 0,
)
__decorate$1([attr], Button$1.prototype, "formtarget", void 0)
__decorate$1([attr], Button$1.prototype, "type", void 0)
__decorate$1([observable], Button$1.prototype, "defaultSlottedContent", void 0)
/**
 * Includes ARIA states and properties relating to the ARIA button role
 *
 * @public
 */
class DelegatesARIAButton {}
__decorate$1(
	[
		attr({
			attribute: "aria-expanded",
		}),
	],
	DelegatesARIAButton.prototype,
	"ariaExpanded",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "aria-pressed",
		}),
	],
	DelegatesARIAButton.prototype,
	"ariaPressed",
	void 0,
)
applyMixins(DelegatesARIAButton, ARIAGlobalStatesAndProperties)
applyMixins(Button$1, StartEnd, DelegatesARIAButton)

/**
 * Enumerates the data grid auto generated header options
 * default option generates a non-sticky header row
 *
 * @public
 */
const GenerateHeaderOptions = {
	none: "none",
	default: "default",
	sticky: "sticky",
}
/**
 * Enumerates possible data grid cell types.
 *
 * @public
 */
const DataGridCellTypes = {
	default: "default",
	columnHeader: "columnheader",
	rowHeader: "rowheader",
}
/**
 * Enumerates possible data grid row types
 *
 * @public
 */
const DataGridRowTypes = {
	default: "default",
	header: "header",
	stickyHeader: "sticky-header",
}

/**
 * A Data Grid Row Custom HTML Element.
 *
 * @fires row-focused - Fires a custom 'row-focused' event when focus is on an element (usually a cell or its contents) in the row
 * @slot - The default slot for custom cell elements
 * @public
 */
class DataGridRow$1 extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * The type of row
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: row-type
		 */
		this.rowType = DataGridRowTypes.default
		/**
		 * The base data for this row
		 *
		 * @public
		 */
		this.rowData = null
		/**
		 * The column definitions of the row
		 *
		 * @public
		 */
		this.columnDefinitions = null
		/**
		 * Whether focus is on/in a cell within this row.
		 *
		 * @internal
		 */
		this.isActiveRow = false
		this.cellsRepeatBehavior = null
		this.cellsPlaceholder = null
		/**
		 * @internal
		 */
		this.focusColumnIndex = 0
		this.refocusOnLoad = false
		this.updateRowStyle = () => {
			this.style.gridTemplateColumns = this.gridTemplateColumns
		}
	}
	gridTemplateColumnsChanged() {
		if (this.$fastController.isConnected) {
			this.updateRowStyle()
		}
	}
	rowTypeChanged() {
		if (this.$fastController.isConnected) {
			this.updateItemTemplate()
		}
	}
	rowDataChanged() {
		if (this.rowData !== null && this.isActiveRow) {
			this.refocusOnLoad = true
			return
		}
	}
	cellItemTemplateChanged() {
		this.updateItemTemplate()
	}
	headerCellItemTemplateChanged() {
		this.updateItemTemplate()
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// note that row elements can be reused with a different data object
		// as the parent grid's repeat behavior reacts to changes in the data set.
		if (this.cellsRepeatBehavior === null) {
			this.cellsPlaceholder = document.createComment("")
			this.appendChild(this.cellsPlaceholder)
			this.updateItemTemplate()
			this.cellsRepeatBehavior = new RepeatDirective(
				(x) => x.columnDefinitions,
				(x) => x.activeCellItemTemplate,
				{
					positioning: true,
				},
			).createBehavior(this.cellsPlaceholder)
			/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
			this.$fastController.addBehaviors([this.cellsRepeatBehavior])
		}
		this.addEventListener("cell-focused", this.handleCellFocus)
		this.addEventListener(eventFocusOut, this.handleFocusout)
		this.addEventListener(eventKeyDown, this.handleKeydown)
		this.updateRowStyle()
		if (this.refocusOnLoad) {
			// if focus was on the row when data changed try to refocus on same cell
			this.refocusOnLoad = false
			if (this.cellElements.length > this.focusColumnIndex) {
				this.cellElements[this.focusColumnIndex].focus()
			}
		}
	}
	/**
	 * @internal
	 */
	disconnectedCallback() {
		super.disconnectedCallback()
		this.removeEventListener("cell-focused", this.handleCellFocus)
		this.removeEventListener(eventFocusOut, this.handleFocusout)
		this.removeEventListener(eventKeyDown, this.handleKeydown)
	}
	handleFocusout(e) {
		if (!this.contains(e.target)) {
			this.isActiveRow = false
			this.focusColumnIndex = 0
		}
	}
	handleCellFocus(e) {
		this.isActiveRow = true
		this.focusColumnIndex = this.cellElements.indexOf(e.target)
		this.$emit("row-focused", this)
	}
	handleKeydown(e) {
		if (e.defaultPrevented) {
			return
		}
		let newFocusColumnIndex = 0
		switch (e.key) {
			case keyArrowLeft:
				// focus left one cell
				newFocusColumnIndex = Math.max(0, this.focusColumnIndex - 1)
				this.cellElements[newFocusColumnIndex].focus()
				e.preventDefault()
				break
			case keyArrowRight:
				// focus right one cell
				newFocusColumnIndex = Math.min(this.cellElements.length - 1, this.focusColumnIndex + 1)
				this.cellElements[newFocusColumnIndex].focus()
				e.preventDefault()
				break
			case keyHome:
				if (!e.ctrlKey) {
					this.cellElements[0].focus()
					e.preventDefault()
				}
				break
			case keyEnd:
				if (!e.ctrlKey) {
					// focus last cell of the row
					this.cellElements[this.cellElements.length - 1].focus()
					e.preventDefault()
				}
				break
		}
	}
	updateItemTemplate() {
		this.activeCellItemTemplate =
			this.rowType === DataGridRowTypes.default && this.cellItemTemplate !== undefined
				? this.cellItemTemplate
				: this.rowType === DataGridRowTypes.default && this.cellItemTemplate === undefined
					? this.defaultCellItemTemplate
					: this.headerCellItemTemplate !== undefined
						? this.headerCellItemTemplate
						: this.defaultHeaderCellItemTemplate
	}
}
__decorate$1(
	[
		attr({
			attribute: "grid-template-columns",
		}),
	],
	DataGridRow$1.prototype,
	"gridTemplateColumns",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "row-type",
		}),
	],
	DataGridRow$1.prototype,
	"rowType",
	void 0,
)
__decorate$1([observable], DataGridRow$1.prototype, "rowData", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "columnDefinitions", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "cellItemTemplate", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "headerCellItemTemplate", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "rowIndex", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "isActiveRow", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "activeCellItemTemplate", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "defaultCellItemTemplate", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "defaultHeaderCellItemTemplate", void 0)
__decorate$1([observable], DataGridRow$1.prototype, "cellElements", void 0)

function createRowItemTemplate(context) {
	const rowTag = context.tagFor(DataGridRow$1)
	return html`<${rowTag} :rowData="${(x) => x}" :cellItemTemplate="${(x, c) => c.parent.cellItemTemplate}" :headerCellItemTemplate="${(x, c) => c.parent.headerCellItemTemplate}"></${rowTag}>`
}
/**
 * Generates a template for the {@link @microsoft/fast-foundation#DataGrid} component using
 * the provided prefix.
 *
 * @public
 */
const dataGridTemplate = (context, definition) => {
	const rowItemTemplate = createRowItemTemplate(context)
	const rowTag = context.tagFor(DataGridRow$1)
	return html`<template
		role="grid"
		tabindex="0"
		:rowElementTag="${() => rowTag}"
		:defaultRowItemTemplate="${rowItemTemplate}"
		${children({
			property: "rowElements",
			filter: elements("[role=row]"),
		})}
		><slot></slot
	></template>`
}

/**
 * A Data Grid Custom HTML Element.
 *
 * @slot - The default slot for custom row elements
 * @public
 */
class DataGrid$1 extends FoundationElement {
	constructor() {
		super()
		/**
		 * When true the component will not add itself to the tab queue.
		 * Default is false.
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: no-tabbing
		 */
		this.noTabbing = false
		/**
		 *  Whether the grid should automatically generate a header row and its type
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: generate-header
		 */
		this.generateHeader = GenerateHeaderOptions.default
		/**
		 * The data being displayed in the grid
		 *
		 * @public
		 */
		this.rowsData = []
		/**
		 * The column definitions of the grid
		 *
		 * @public
		 */
		this.columnDefinitions = null
		/**
		 * The index of the row that will receive focus the next time the
		 * grid is focused. This value changes as focus moves to different
		 * rows within the grid.  Changing this value when focus is already
		 * within the grid moves focus to the specified row.
		 *
		 * @public
		 */
		this.focusRowIndex = 0
		/**
		 * The index of the column that will receive focus the next time the
		 * grid is focused. This value changes as focus moves to different rows
		 * within the grid.  Changing this value when focus is already within
		 * the grid moves focus to the specified column.
		 *
		 * @public
		 */
		this.focusColumnIndex = 0
		this.rowsPlaceholder = null
		this.generatedHeader = null
		this.isUpdatingFocus = false
		this.pendingFocusUpdate = false
		this.rowindexUpdateQueued = false
		this.columnDefinitionsStale = true
		this.generatedGridTemplateColumns = ""
		this.focusOnCell = (rowIndex, columnIndex, scrollIntoView) => {
			if (this.rowElements.length === 0) {
				this.focusRowIndex = 0
				this.focusColumnIndex = 0
				return
			}
			const focusRowIndex = Math.max(0, Math.min(this.rowElements.length - 1, rowIndex))
			const focusRow = this.rowElements[focusRowIndex]
			const cells = focusRow.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]')
			const focusColumnIndex = Math.max(0, Math.min(cells.length - 1, columnIndex))
			const focusTarget = cells[focusColumnIndex]
			if (
				scrollIntoView &&
				this.scrollHeight !== this.clientHeight &&
				((focusRowIndex < this.focusRowIndex && this.scrollTop > 0) ||
					(focusRowIndex > this.focusRowIndex && this.scrollTop < this.scrollHeight - this.clientHeight))
			) {
				focusTarget.scrollIntoView({
					block: "center",
					inline: "center",
				})
			}
			focusTarget.focus()
		}
		this.onChildListChange = (mutations /* eslint-disable-next-line @typescript-eslint/no-unused-vars */, observer) => {
			if (mutations && mutations.length) {
				mutations.forEach((mutation) => {
					mutation.addedNodes.forEach((newNode) => {
						if (newNode.nodeType === 1 && newNode.getAttribute("role") === "row") {
							newNode.columnDefinitions = this.columnDefinitions
						}
					})
				})
				this.queueRowIndexUpdate()
			}
		}
		this.queueRowIndexUpdate = () => {
			if (!this.rowindexUpdateQueued) {
				this.rowindexUpdateQueued = true
				DOM.queueUpdate(this.updateRowIndexes)
			}
		}
		this.updateRowIndexes = () => {
			let newGridTemplateColumns = this.gridTemplateColumns
			if (newGridTemplateColumns === undefined) {
				// try to generate columns based on manual rows
				if (this.generatedGridTemplateColumns === "" && this.rowElements.length > 0) {
					const firstRow = this.rowElements[0]
					this.generatedGridTemplateColumns = new Array(firstRow.cellElements.length).fill("1fr").join(" ")
				}
				newGridTemplateColumns = this.generatedGridTemplateColumns
			}
			this.rowElements.forEach((element, index) => {
				const thisRow = element
				thisRow.rowIndex = index
				thisRow.gridTemplateColumns = newGridTemplateColumns
				if (this.columnDefinitionsStale) {
					thisRow.columnDefinitions = this.columnDefinitions
				}
			})
			this.rowindexUpdateQueued = false
			this.columnDefinitionsStale = false
		}
	}
	/**
	 *  generates a gridTemplateColumns based on columndata array
	 */
	static generateTemplateColumns(columnDefinitions) {
		let templateColumns = ""
		columnDefinitions.forEach((column) => {
			templateColumns = `${templateColumns}${templateColumns === "" ? "" : " "}${"1fr"}`
		})
		return templateColumns
	}
	noTabbingChanged() {
		if (this.$fastController.isConnected) {
			if (this.noTabbing) {
				this.setAttribute("tabIndex", "-1")
			} else {
				this.setAttribute(
					"tabIndex",
					this.contains(document.activeElement) || this === document.activeElement ? "-1" : "0",
				)
			}
		}
	}
	generateHeaderChanged() {
		if (this.$fastController.isConnected) {
			this.toggleGeneratedHeader()
		}
	}
	gridTemplateColumnsChanged() {
		if (this.$fastController.isConnected) {
			this.updateRowIndexes()
		}
	}
	rowsDataChanged() {
		if (this.columnDefinitions === null && this.rowsData.length > 0) {
			this.columnDefinitions = DataGrid$1.generateColumns(this.rowsData[0])
		}
		if (this.$fastController.isConnected) {
			this.toggleGeneratedHeader()
		}
	}
	columnDefinitionsChanged() {
		if (this.columnDefinitions === null) {
			this.generatedGridTemplateColumns = ""
			return
		}
		this.generatedGridTemplateColumns = DataGrid$1.generateTemplateColumns(this.columnDefinitions)
		if (this.$fastController.isConnected) {
			this.columnDefinitionsStale = true
			this.queueRowIndexUpdate()
		}
	}
	headerCellItemTemplateChanged() {
		if (this.$fastController.isConnected) {
			if (this.generatedHeader !== null) {
				this.generatedHeader.headerCellItemTemplate = this.headerCellItemTemplate
			}
		}
	}
	focusRowIndexChanged() {
		if (this.$fastController.isConnected) {
			this.queueFocusUpdate()
		}
	}
	focusColumnIndexChanged() {
		if (this.$fastController.isConnected) {
			this.queueFocusUpdate()
		}
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		if (this.rowItemTemplate === undefined) {
			this.rowItemTemplate = this.defaultRowItemTemplate
		}
		this.rowsPlaceholder = document.createComment("")
		this.appendChild(this.rowsPlaceholder)
		this.toggleGeneratedHeader()
		this.rowsRepeatBehavior = new RepeatDirective(
			(x) => x.rowsData,
			(x) => x.rowItemTemplate,
			{
				positioning: true,
			},
		).createBehavior(this.rowsPlaceholder)
		/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
		this.$fastController.addBehaviors([this.rowsRepeatBehavior])
		this.addEventListener("row-focused", this.handleRowFocus)
		this.addEventListener(eventFocus, this.handleFocus)
		this.addEventListener(eventKeyDown, this.handleKeydown)
		this.addEventListener(eventFocusOut, this.handleFocusOut)
		this.observer = new MutationObserver(this.onChildListChange)
		// only observe if nodes are added or removed
		this.observer.observe(this, {
			childList: true,
		})
		if (this.noTabbing) {
			this.setAttribute("tabindex", "-1")
		}
		DOM.queueUpdate(this.queueRowIndexUpdate)
	}
	/**
	 * @internal
	 */
	disconnectedCallback() {
		super.disconnectedCallback()
		this.removeEventListener("row-focused", this.handleRowFocus)
		this.removeEventListener(eventFocus, this.handleFocus)
		this.removeEventListener(eventKeyDown, this.handleKeydown)
		this.removeEventListener(eventFocusOut, this.handleFocusOut)
		// disconnect observer
		this.observer.disconnect()
		this.rowsPlaceholder = null
		this.generatedHeader = null
	}
	/**
	 * @internal
	 */
	handleRowFocus(e) {
		this.isUpdatingFocus = true
		const focusRow = e.target
		this.focusRowIndex = this.rowElements.indexOf(focusRow)
		this.focusColumnIndex = focusRow.focusColumnIndex
		this.setAttribute("tabIndex", "-1")
		this.isUpdatingFocus = false
	}
	/**
	 * @internal
	 */
	handleFocus(e) {
		this.focusOnCell(this.focusRowIndex, this.focusColumnIndex, true)
	}
	/**
	 * @internal
	 */
	handleFocusOut(e) {
		if (e.relatedTarget === null || !this.contains(e.relatedTarget)) {
			this.setAttribute("tabIndex", this.noTabbing ? "-1" : "0")
		}
	}
	/**
	 * @internal
	 */
	handleKeydown(e) {
		if (e.defaultPrevented) {
			return
		}
		let newFocusRowIndex
		const maxIndex = this.rowElements.length - 1
		const currentGridBottom = this.offsetHeight + this.scrollTop
		const lastRow = this.rowElements[maxIndex]
		switch (e.key) {
			case keyArrowUp:
				e.preventDefault()
				// focus up one row
				this.focusOnCell(this.focusRowIndex - 1, this.focusColumnIndex, true)
				break
			case keyArrowDown:
				e.preventDefault()
				// focus down one row
				this.focusOnCell(this.focusRowIndex + 1, this.focusColumnIndex, true)
				break
			case keyPageUp:
				e.preventDefault()
				if (this.rowElements.length === 0) {
					this.focusOnCell(0, 0, false)
					break
				}
				if (this.focusRowIndex === 0) {
					this.focusOnCell(0, this.focusColumnIndex, false)
					return
				}
				newFocusRowIndex = this.focusRowIndex - 1
				for (newFocusRowIndex; newFocusRowIndex >= 0; newFocusRowIndex--) {
					const thisRow = this.rowElements[newFocusRowIndex]
					if (thisRow.offsetTop < this.scrollTop) {
						this.scrollTop = thisRow.offsetTop + thisRow.clientHeight - this.clientHeight
						break
					}
				}
				this.focusOnCell(newFocusRowIndex, this.focusColumnIndex, false)
				break
			case keyPageDown:
				e.preventDefault()
				if (this.rowElements.length === 0) {
					this.focusOnCell(0, 0, false)
					break
				}
				// focus down one "page"
				if (this.focusRowIndex >= maxIndex || lastRow.offsetTop + lastRow.offsetHeight <= currentGridBottom) {
					this.focusOnCell(maxIndex, this.focusColumnIndex, false)
					return
				}
				newFocusRowIndex = this.focusRowIndex + 1
				for (newFocusRowIndex; newFocusRowIndex <= maxIndex; newFocusRowIndex++) {
					const thisRow = this.rowElements[newFocusRowIndex]
					if (thisRow.offsetTop + thisRow.offsetHeight > currentGridBottom) {
						let stickyHeaderOffset = 0
						if (this.generateHeader === GenerateHeaderOptions.sticky && this.generatedHeader !== null) {
							stickyHeaderOffset = this.generatedHeader.clientHeight
						}
						this.scrollTop = thisRow.offsetTop - stickyHeaderOffset
						break
					}
				}
				this.focusOnCell(newFocusRowIndex, this.focusColumnIndex, false)
				break
			case keyHome:
				if (e.ctrlKey) {
					e.preventDefault()
					// focus first cell of first row
					this.focusOnCell(0, 0, true)
				}
				break
			case keyEnd:
				if (e.ctrlKey && this.columnDefinitions !== null) {
					e.preventDefault()
					// focus last cell of last row
					this.focusOnCell(this.rowElements.length - 1, this.columnDefinitions.length - 1, true)
				}
				break
		}
	}
	queueFocusUpdate() {
		if (this.isUpdatingFocus && (this.contains(document.activeElement) || this === document.activeElement)) {
			return
		}
		if (this.pendingFocusUpdate === false) {
			this.pendingFocusUpdate = true
			DOM.queueUpdate(() => this.updateFocus())
		}
	}
	updateFocus() {
		this.pendingFocusUpdate = false
		this.focusOnCell(this.focusRowIndex, this.focusColumnIndex, true)
	}
	toggleGeneratedHeader() {
		if (this.generatedHeader !== null) {
			this.removeChild(this.generatedHeader)
			this.generatedHeader = null
		}
		if (this.generateHeader !== GenerateHeaderOptions.none && this.rowsData.length > 0) {
			const generatedHeaderElement = document.createElement(this.rowElementTag)
			this.generatedHeader = generatedHeaderElement
			this.generatedHeader.columnDefinitions = this.columnDefinitions
			this.generatedHeader.gridTemplateColumns = this.gridTemplateColumns
			this.generatedHeader.rowType =
				this.generateHeader === GenerateHeaderOptions.sticky ? DataGridRowTypes.stickyHeader : DataGridRowTypes.header
			if (this.firstChild !== null || this.rowsPlaceholder !== null) {
				this.insertBefore(generatedHeaderElement, this.firstChild !== null ? this.firstChild : this.rowsPlaceholder)
			}
			return
		}
	}
}
/**
 *  generates a basic column definition by examining sample row data
 */
DataGrid$1.generateColumns = (row) => {
	return Object.getOwnPropertyNames(row).map((property, index) => {
		return {
			columnDataKey: property,
			gridColumn: `${index}`,
		}
	})
}
__decorate$1(
	[
		attr({
			attribute: "no-tabbing",
			mode: "boolean",
		}),
	],
	DataGrid$1.prototype,
	"noTabbing",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "generate-header",
		}),
	],
	DataGrid$1.prototype,
	"generateHeader",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "grid-template-columns",
		}),
	],
	DataGrid$1.prototype,
	"gridTemplateColumns",
	void 0,
)
__decorate$1([observable], DataGrid$1.prototype, "rowsData", void 0)
__decorate$1([observable], DataGrid$1.prototype, "columnDefinitions", void 0)
__decorate$1([observable], DataGrid$1.prototype, "rowItemTemplate", void 0)
__decorate$1([observable], DataGrid$1.prototype, "cellItemTemplate", void 0)
__decorate$1([observable], DataGrid$1.prototype, "headerCellItemTemplate", void 0)
__decorate$1([observable], DataGrid$1.prototype, "focusRowIndex", void 0)
__decorate$1([observable], DataGrid$1.prototype, "focusColumnIndex", void 0)
__decorate$1([observable], DataGrid$1.prototype, "defaultRowItemTemplate", void 0)
__decorate$1([observable], DataGrid$1.prototype, "rowElementTag", void 0)
__decorate$1([observable], DataGrid$1.prototype, "rowElements", void 0)

const defaultCellContentsTemplate = html`<template
	>${(x) =>
		x.rowData === null || x.columnDefinition === null || x.columnDefinition.columnDataKey === null
			? null
			: x.rowData[x.columnDefinition.columnDataKey]}</template
>`
const defaultHeaderCellContentsTemplate = html`<template
	>${(x) =>
		x.columnDefinition === null
			? null
			: x.columnDefinition.title === undefined
				? x.columnDefinition.columnDataKey
				: x.columnDefinition.title}</template
>`
/**
 * A Data Grid Cell Custom HTML Element.
 *
 * @fires cell-focused - Fires a custom 'cell-focused' event when focus is on the cell or its contents
 * @slot - The default slot for cell contents.  The "cell contents template" renders here.
 * @public
 */
class DataGridCell$1 extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * The type of cell
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: cell-type
		 */
		this.cellType = DataGridCellTypes.default
		/**
		 * The base data for the parent row
		 *
		 * @public
		 */
		this.rowData = null
		/**
		 * The base data for the column
		 *
		 * @public
		 */
		this.columnDefinition = null
		this.isActiveCell = false
		this.customCellView = null
		this.updateCellStyle = () => {
			this.style.gridColumn = this.gridColumn
		}
	}
	cellTypeChanged() {
		if (this.$fastController.isConnected) {
			this.updateCellView()
		}
	}
	gridColumnChanged() {
		if (this.$fastController.isConnected) {
			this.updateCellStyle()
		}
	}
	columnDefinitionChanged(oldValue, newValue) {
		if (this.$fastController.isConnected) {
			this.updateCellView()
		}
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		var _a
		super.connectedCallback()
		this.addEventListener(eventFocusIn, this.handleFocusin)
		this.addEventListener(eventFocusOut, this.handleFocusout)
		this.addEventListener(eventKeyDown, this.handleKeydown)
		this.style.gridColumn = `${((_a = this.columnDefinition) === null || _a === void 0 ? void 0 : _a.gridColumn) === undefined ? 0 : this.columnDefinition.gridColumn}`
		this.updateCellView()
		this.updateCellStyle()
	}
	/**
	 * @internal
	 */
	disconnectedCallback() {
		super.disconnectedCallback()
		this.removeEventListener(eventFocusIn, this.handleFocusin)
		this.removeEventListener(eventFocusOut, this.handleFocusout)
		this.removeEventListener(eventKeyDown, this.handleKeydown)
		this.disconnectCellView()
	}
	handleFocusin(e) {
		if (this.isActiveCell) {
			return
		}
		this.isActiveCell = true
		switch (this.cellType) {
			case DataGridCellTypes.columnHeader:
				if (
					this.columnDefinition !== null &&
					this.columnDefinition.headerCellInternalFocusQueue !== true &&
					typeof this.columnDefinition.headerCellFocusTargetCallback === "function"
				) {
					// move focus to the focus target
					const focusTarget = this.columnDefinition.headerCellFocusTargetCallback(this)
					if (focusTarget !== null) {
						focusTarget.focus()
					}
				}
				break
			default:
				if (
					this.columnDefinition !== null &&
					this.columnDefinition.cellInternalFocusQueue !== true &&
					typeof this.columnDefinition.cellFocusTargetCallback === "function"
				) {
					// move focus to the focus target
					const focusTarget = this.columnDefinition.cellFocusTargetCallback(this)
					if (focusTarget !== null) {
						focusTarget.focus()
					}
				}
				break
		}
		this.$emit("cell-focused", this)
	}
	handleFocusout(e) {
		if (this !== document.activeElement && !this.contains(document.activeElement)) {
			this.isActiveCell = false
		}
	}
	handleKeydown(e) {
		if (
			e.defaultPrevented ||
			this.columnDefinition === null ||
			(this.cellType === DataGridCellTypes.default && this.columnDefinition.cellInternalFocusQueue !== true) ||
			(this.cellType === DataGridCellTypes.columnHeader && this.columnDefinition.headerCellInternalFocusQueue !== true)
		) {
			return
		}
		switch (e.key) {
			case keyEnter:
			case keyFunction2:
				if (this.contains(document.activeElement) && document.activeElement !== this) {
					return
				}
				switch (this.cellType) {
					case DataGridCellTypes.columnHeader:
						if (this.columnDefinition.headerCellFocusTargetCallback !== undefined) {
							const focusTarget = this.columnDefinition.headerCellFocusTargetCallback(this)
							if (focusTarget !== null) {
								focusTarget.focus()
							}
							e.preventDefault()
						}
						break
					default:
						if (this.columnDefinition.cellFocusTargetCallback !== undefined) {
							const focusTarget = this.columnDefinition.cellFocusTargetCallback(this)
							if (focusTarget !== null) {
								focusTarget.focus()
							}
							e.preventDefault()
						}
						break
				}
				break
			case keyEscape:
				if (this.contains(document.activeElement) && document.activeElement !== this) {
					this.focus()
					e.preventDefault()
				}
				break
		}
	}
	updateCellView() {
		this.disconnectCellView()
		if (this.columnDefinition === null) {
			return
		}
		switch (this.cellType) {
			case DataGridCellTypes.columnHeader:
				if (this.columnDefinition.headerCellTemplate !== undefined) {
					this.customCellView = this.columnDefinition.headerCellTemplate.render(this, this)
				} else {
					this.customCellView = defaultHeaderCellContentsTemplate.render(this, this)
				}
				break
			case undefined:
			case DataGridCellTypes.rowHeader:
			case DataGridCellTypes.default:
				if (this.columnDefinition.cellTemplate !== undefined) {
					this.customCellView = this.columnDefinition.cellTemplate.render(this, this)
				} else {
					this.customCellView = defaultCellContentsTemplate.render(this, this)
				}
				break
		}
	}
	disconnectCellView() {
		if (this.customCellView !== null) {
			this.customCellView.dispose()
			this.customCellView = null
		}
	}
}
__decorate$1(
	[
		attr({
			attribute: "cell-type",
		}),
	],
	DataGridCell$1.prototype,
	"cellType",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "grid-column",
		}),
	],
	DataGridCell$1.prototype,
	"gridColumn",
	void 0,
)
__decorate$1([observable], DataGridCell$1.prototype, "rowData", void 0)
__decorate$1([observable], DataGridCell$1.prototype, "columnDefinition", void 0)

function createCellItemTemplate(context) {
	const cellTag = context.tagFor(DataGridCell$1)
	return html`<${cellTag} cell-type="${(x) => (x.isRowHeader ? "rowheader" : undefined)}" grid-column="${(x, c) => c.index + 1}" :rowData="${(x, c) => c.parent.rowData}" :columnDefinition="${(x) => x}"></${cellTag}>`
}
function createHeaderCellItemTemplate(context) {
	const cellTag = context.tagFor(DataGridCell$1)
	return html`<${cellTag} cell-type="columnheader" grid-column="${(x, c) => c.index + 1}" :columnDefinition="${(x) => x}"></${cellTag}>`
}
/**
 * Generates a template for the {@link @microsoft/fast-foundation#DataGridRow} component using
 * the provided prefix.
 *
 * @public
 */
const dataGridRowTemplate = (context, definition) => {
	const cellItemTemplate = createCellItemTemplate(context)
	const headerCellItemTemplate = createHeaderCellItemTemplate(context)
	return html`<template
		role="row"
		class="${(x) => (x.rowType !== "default" ? x.rowType : "")}"
		:defaultCellItemTemplate="${cellItemTemplate}"
		:defaultHeaderCellItemTemplate="${headerCellItemTemplate}"
		${children({
			property: "cellElements",
			filter: elements('[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]'),
		})}
		><slot ${slotted("slottedCellElements")}></slot
	></template>`
}

/**
 * Generates a template for the {@link @microsoft/fast-foundation#DataGridCell} component using
 * the provided prefix.
 * @public
 */
const dataGridCellTemplate = (context, definition) => {
	return html`<template
		tabindex="-1"
		role="${(x) => (!x.cellType || x.cellType === "default" ? "gridcell" : x.cellType)}"
		class=" ${(x) => (x.cellType === "columnheader" ? "column-header" : x.cellType === "rowheader" ? "row-header" : "")} "
		><slot></slot
	></template>`
}

/**
 * The template for the {@link @microsoft/fast-foundation#(Checkbox:class)} component.
 * @public
 */
const checkboxTemplate = (context, definition) =>
	html`<template
		role="checkbox"
		aria-checked="${(x) => x.checked}"
		aria-required="${(x) => x.required}"
		aria-disabled="${(x) => x.disabled}"
		aria-readonly="${(x) => x.readOnly}"
		tabindex="${(x) => (x.disabled ? null : 0)}"
		@keypress="${(x, c) => x.keypressHandler(c.event)}"
		@click="${(x, c) => x.clickHandler(c.event)}"
		class="${(x) => (x.readOnly ? "readonly" : "")} ${(x) => (x.checked ? "checked" : "")} ${(x) =>
			x.indeterminate ? "indeterminate" : ""}"
		><div part="control" class="control">
			<slot name="checked-indicator">${definition.checkedIndicator || ""}</slot
			><slot name="indeterminate-indicator">${definition.indeterminateIndicator || ""}</slot>
		</div>
		<label
			part="label"
			class="${(x) => (x.defaultSlottedNodes && x.defaultSlottedNodes.length ? "label" : "label label__hidden")}"
			><slot ${slotted("defaultSlottedNodes")}></slot></label
	></template>`

class _Checkbox extends FoundationElement {}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Checkbox:class)} component.
 *
 * @internal
 */
class FormAssociatedCheckbox extends CheckableFormAssociated(_Checkbox) {
	constructor() {
		super(...arguments)
		this.proxy = document.createElement("input")
	}
}

/**
 * A Checkbox Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#checkbox | ARIA checkbox }.
 *
 * @slot checked-indicator - The checked indicator
 * @slot indeterminate-indicator - The indeterminate indicator
 * @slot - The default slot for the label
 * @csspart control - The element representing the visual checkbox control
 * @csspart label - The label
 * @fires change - Emits a custom change event when the checked state changes
 *
 * @public
 */
class Checkbox$1 extends FormAssociatedCheckbox {
	constructor() {
		super()
		/**
		 * The element's value to be included in form submission when checked.
		 * Default to "on" to reach parity with input[type="checkbox"]
		 *
		 * @internal
		 */
		this.initialValue = "on"
		/**
		 * The indeterminate state of the control
		 */
		this.indeterminate = false
		/**
		 * @internal
		 */
		this.keypressHandler = (e) => {
			if (this.readOnly) {
				return
			}
			switch (e.key) {
				case keySpace:
					if (this.indeterminate) {
						this.indeterminate = false
					}
					this.checked = !this.checked
					break
			}
		}
		/**
		 * @internal
		 */
		this.clickHandler = (e) => {
			if (!this.disabled && !this.readOnly) {
				if (this.indeterminate) {
					this.indeterminate = false
				}
				this.checked = !this.checked
			}
		}
		this.proxy.setAttribute("type", "checkbox")
	}
	readOnlyChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.readOnly = this.readOnly
		}
	}
}
__decorate$1(
	[
		attr({
			attribute: "readonly",
			mode: "boolean",
		}),
	],
	Checkbox$1.prototype,
	"readOnly",
	void 0,
)
__decorate$1([observable], Checkbox$1.prototype, "defaultSlottedNodes", void 0)
__decorate$1([observable], Checkbox$1.prototype, "indeterminate", void 0)

/**
 * Determines if the element is a {@link (ListboxOption:class)}
 *
 * @param element - the element to test.
 * @public
 */
function isListboxOption(el) {
	return isHTMLElement(el) && (el.getAttribute("role") === "option" || el instanceof HTMLOptionElement)
}
/**
 * An Option Custom HTML Element.
 * Implements {@link https://www.w3.org/TR/wai-aria-1.1/#option | ARIA option }.
 *
 * @slot start - Content which can be provided before the listbox option content
 * @slot end - Content which can be provided after the listbox option content
 * @slot - The default slot for listbox option content
 * @csspart content - Wraps the listbox option content
 *
 * @public
 */
class ListboxOption extends FoundationElement {
	constructor(text, value, defaultSelected, selected) {
		super()
		/**
		 * The defaultSelected state of the option.
		 * @public
		 */
		this.defaultSelected = false
		/**
		 * Tracks whether the "selected" property has been changed.
		 * @internal
		 */
		this.dirtySelected = false
		/**
		 * The checked state of the control.
		 *
		 * @public
		 */
		this.selected = this.defaultSelected
		/**
		 * Track whether the value has been changed from the initial value
		 */
		this.dirtyValue = false
		if (text) {
			this.textContent = text
		}
		if (value) {
			this.initialValue = value
		}
		if (defaultSelected) {
			this.defaultSelected = defaultSelected
		}
		if (selected) {
			this.selected = selected
		}
		this.proxy = new Option(`${this.textContent}`, this.initialValue, this.defaultSelected, this.selected)
		this.proxy.disabled = this.disabled
	}
	/**
	 * Updates the ariaChecked property when the checked property changes.
	 *
	 * @param prev - the previous checked value
	 * @param next - the current checked value
	 *
	 * @public
	 */
	checkedChanged(prev, next) {
		if (typeof next === "boolean") {
			this.ariaChecked = next ? "true" : "false"
			return
		}
		this.ariaChecked = null
	}
	/**
	 * Updates the proxy's text content when the default slot changes.
	 * @param prev - the previous content value
	 * @param next - the current content value
	 *
	 * @internal
	 */
	contentChanged(prev, next) {
		if (this.proxy instanceof HTMLOptionElement) {
			this.proxy.textContent = this.textContent
		}
		this.$emit("contentchange", null, {
			bubbles: true,
		})
	}
	defaultSelectedChanged() {
		if (!this.dirtySelected) {
			this.selected = this.defaultSelected
			if (this.proxy instanceof HTMLOptionElement) {
				this.proxy.selected = this.defaultSelected
			}
		}
	}
	disabledChanged(prev, next) {
		this.ariaDisabled = this.disabled ? "true" : "false"
		if (this.proxy instanceof HTMLOptionElement) {
			this.proxy.disabled = this.disabled
		}
	}
	selectedAttributeChanged() {
		this.defaultSelected = this.selectedAttribute
		if (this.proxy instanceof HTMLOptionElement) {
			this.proxy.defaultSelected = this.defaultSelected
		}
	}
	selectedChanged() {
		this.ariaSelected = this.selected ? "true" : "false"
		if (!this.dirtySelected) {
			this.dirtySelected = true
		}
		if (this.proxy instanceof HTMLOptionElement) {
			this.proxy.selected = this.selected
		}
	}
	initialValueChanged(previous, next) {
		// If the value is clean and the component is connected to the DOM
		// then set value equal to the attribute value.
		if (!this.dirtyValue) {
			this.value = this.initialValue
			this.dirtyValue = false
		}
	}
	get label() {
		var _a
		return (_a = this.value) !== null && _a !== void 0 ? _a : this.text
	}
	get text() {
		var _a, _b
		return (_b = (_a = this.textContent) === null || _a === void 0 ? void 0 : _a.replace(/\s+/g, " ").trim()) !== null &&
			_b !== void 0
			? _b
			: ""
	}
	set value(next) {
		const newValue = `${next !== null && next !== void 0 ? next : ""}`
		this._value = newValue
		this.dirtyValue = true
		if (this.proxy instanceof HTMLOptionElement) {
			this.proxy.value = newValue
		}
		Observable.notify(this, "value")
	}
	get value() {
		var _a
		Observable.track(this, "value")
		return (_a = this._value) !== null && _a !== void 0 ? _a : this.text
	}
	get form() {
		return this.proxy ? this.proxy.form : null
	}
}
__decorate$1([observable], ListboxOption.prototype, "checked", void 0)
__decorate$1([observable], ListboxOption.prototype, "content", void 0)
__decorate$1([observable], ListboxOption.prototype, "defaultSelected", void 0)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	ListboxOption.prototype,
	"disabled",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "selected",
			mode: "boolean",
		}),
	],
	ListboxOption.prototype,
	"selectedAttribute",
	void 0,
)
__decorate$1([observable], ListboxOption.prototype, "selected", void 0)
__decorate$1(
	[
		attr({
			attribute: "value",
			mode: "fromView",
		}),
	],
	ListboxOption.prototype,
	"initialValue",
	void 0,
)
/**
 * States and properties relating to the ARIA `option` role.
 *
 * @public
 */
class DelegatesARIAListboxOption {}
__decorate$1([observable], DelegatesARIAListboxOption.prototype, "ariaChecked", void 0)
__decorate$1([observable], DelegatesARIAListboxOption.prototype, "ariaPosInSet", void 0)
__decorate$1([observable], DelegatesARIAListboxOption.prototype, "ariaSelected", void 0)
__decorate$1([observable], DelegatesARIAListboxOption.prototype, "ariaSetSize", void 0)
applyMixins(DelegatesARIAListboxOption, ARIAGlobalStatesAndProperties)
applyMixins(ListboxOption, StartEnd, DelegatesARIAListboxOption)

/**
 * A Listbox Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#listbox | ARIA listbox }.
 *
 * @slot - The default slot for the listbox options
 *
 * @public
 */
class Listbox extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * The internal unfiltered list of selectable options.
		 *
		 * @internal
		 */
		this._options = []
		/**
		 * The index of the selected option.
		 *
		 * @public
		 */
		this.selectedIndex = -1
		/**
		 * A collection of the selected options.
		 *
		 * @public
		 */
		this.selectedOptions = []
		/**
		 * A standard `click` event creates a `focus` event before firing, so a
		 * `mousedown` event is used to skip that initial focus.
		 *
		 * @internal
		 */
		this.shouldSkipFocus = false
		/**
		 * The current typeahead buffer string.
		 *
		 * @internal
		 */
		this.typeaheadBuffer = ""
		/**
		 * Flag for the typeahead timeout expiration.
		 *
		 * @internal
		 */
		this.typeaheadExpired = true
		/**
		 * The timeout ID for the typeahead handler.
		 *
		 * @internal
		 */
		this.typeaheadTimeout = -1
	}
	/**
	 * The first selected option.
	 *
	 * @internal
	 */
	get firstSelectedOption() {
		var _a
		return (_a = this.selectedOptions[0]) !== null && _a !== void 0 ? _a : null
	}
	/**
	 * Returns true if there is one or more selectable option.
	 *
	 * @internal
	 */
	get hasSelectableOptions() {
		return this.options.length > 0 && !this.options.every((o) => o.disabled)
	}
	/**
	 * The number of options.
	 *
	 * @public
	 */
	get length() {
		var _a, _b
		return (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0
	}
	/**
	 * The list of options.
	 *
	 * @public
	 */
	get options() {
		Observable.track(this, "options")
		return this._options
	}
	set options(value) {
		this._options = value
		Observable.notify(this, "options")
	}
	/**
	 * Flag for the typeahead timeout expiration.
	 *
	 * @deprecated use `Listbox.typeaheadExpired`
	 * @internal
	 */
	get typeAheadExpired() {
		return this.typeaheadExpired
	}
	set typeAheadExpired(value) {
		this.typeaheadExpired = value
	}
	/**
	 * Handle click events for listbox options.
	 *
	 * @internal
	 */
	clickHandler(e) {
		const captured = e.target.closest(`option,[role=option]`)
		if (captured && !captured.disabled) {
			this.selectedIndex = this.options.indexOf(captured)
			return true
		}
	}
	/**
	 * Ensures that the provided option is focused and scrolled into view.
	 *
	 * @param optionToFocus - The option to focus
	 * @internal
	 */
	focusAndScrollOptionIntoView(optionToFocus = this.firstSelectedOption) {
		// To ensure that the browser handles both `focus()` and `scrollIntoView()`, the
		// timing here needs to guarantee that they happen on different frames. Since this
		// function is typically called from the `openChanged` observer, `DOM.queueUpdate`
		// causes the calls to be grouped into the same frame. To prevent this,
		// `requestAnimationFrame` is used instead of `DOM.queueUpdate`.
		if (this.contains(document.activeElement) && optionToFocus !== null) {
			optionToFocus.focus()
			requestAnimationFrame(() => {
				optionToFocus.scrollIntoView({
					block: "nearest",
				})
			})
		}
	}
	/**
	 * Handles `focusin` actions for the component. When the component receives focus,
	 * the list of selected options is refreshed and the first selected option is scrolled
	 * into view.
	 *
	 * @internal
	 */
	focusinHandler(e) {
		if (!this.shouldSkipFocus && e.target === e.currentTarget) {
			this.setSelectedOptions()
			this.focusAndScrollOptionIntoView()
		}
		this.shouldSkipFocus = false
	}
	/**
	 * Returns the options which match the current typeahead buffer.
	 *
	 * @internal
	 */
	getTypeaheadMatches() {
		const pattern = this.typeaheadBuffer.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&")
		const re = new RegExp(`^${pattern}`, "gi")
		return this.options.filter((o) => o.text.trim().match(re))
	}
	/**
	 * Determines the index of the next option which is selectable, if any.
	 *
	 * @param prev - the previous selected index
	 * @param next - the next index to select
	 *
	 * @internal
	 */
	getSelectableIndex(prev = this.selectedIndex, next) {
		const direction = prev > next ? -1 : prev < next ? 1 : 0
		const potentialDirection = prev + direction
		let nextSelectableOption = null
		switch (direction) {
			case -1: {
				nextSelectableOption = this.options.reduceRight(
					(nextSelectableOption, thisOption, index) =>
						!nextSelectableOption && !thisOption.disabled && index < potentialDirection
							? thisOption
							: nextSelectableOption,
					nextSelectableOption,
				)
				break
			}
			case 1: {
				nextSelectableOption = this.options.reduce(
					(nextSelectableOption, thisOption, index) =>
						!nextSelectableOption && !thisOption.disabled && index > potentialDirection
							? thisOption
							: nextSelectableOption,
					nextSelectableOption,
				)
				break
			}
		}
		return this.options.indexOf(nextSelectableOption)
	}
	/**
	 * Handles external changes to child options.
	 *
	 * @param source - the source object
	 * @param propertyName - the property
	 *
	 * @internal
	 */
	handleChange(source, propertyName) {
		switch (propertyName) {
			case "selected": {
				if (Listbox.slottedOptionFilter(source)) {
					this.selectedIndex = this.options.indexOf(source)
				}
				this.setSelectedOptions()
				break
			}
		}
	}
	/**
	 * Moves focus to an option whose label matches characters typed by the user.
	 * Consecutive keystrokes are batched into a buffer of search text used
	 * to match against the set of options.  If `TYPE_AHEAD_TIMEOUT_MS` passes
	 * between consecutive keystrokes, the search restarts.
	 *
	 * @param key - the key to be evaluated
	 *
	 * @internal
	 */
	handleTypeAhead(key) {
		if (this.typeaheadTimeout) {
			window.clearTimeout(this.typeaheadTimeout)
		}
		this.typeaheadTimeout = window.setTimeout(() => (this.typeaheadExpired = true), Listbox.TYPE_AHEAD_TIMEOUT_MS)
		if (key.length > 1) {
			return
		}
		this.typeaheadBuffer = `${this.typeaheadExpired ? "" : this.typeaheadBuffer}${key}`
	}
	/**
	 * Handles `keydown` actions for listbox navigation and typeahead.
	 *
	 * @internal
	 */
	keydownHandler(e) {
		if (this.disabled) {
			return true
		}
		this.shouldSkipFocus = false
		const key = e.key
		switch (key) {
			// Select the first available option
			case keyHome: {
				if (!e.shiftKey) {
					e.preventDefault()
					this.selectFirstOption()
				}
				break
			}
			// Select the next selectable option
			case keyArrowDown: {
				if (!e.shiftKey) {
					e.preventDefault()
					this.selectNextOption()
				}
				break
			}
			// Select the previous selectable option
			case keyArrowUp: {
				if (!e.shiftKey) {
					e.preventDefault()
					this.selectPreviousOption()
				}
				break
			}
			// Select the last available option
			case keyEnd: {
				e.preventDefault()
				this.selectLastOption()
				break
			}
			case keyTab: {
				this.focusAndScrollOptionIntoView()
				return true
			}
			case keyEnter:
			case keyEscape: {
				return true
			}
			case keySpace: {
				if (this.typeaheadExpired) {
					return true
				}
			}
			// Send key to Typeahead handler
			default: {
				if (key.length === 1) {
					this.handleTypeAhead(`${key}`)
				}
				return true
			}
		}
	}
	/**
	 * Prevents `focusin` events from firing before `click` events when the
	 * element is unfocused.
	 *
	 * @internal
	 */
	mousedownHandler(e) {
		this.shouldSkipFocus = !this.contains(document.activeElement)
		return true
	}
	/**
	 * Switches between single-selection and multi-selection mode.
	 *
	 * @param prev - the previous value of the `multiple` attribute
	 * @param next - the next value of the `multiple` attribute
	 *
	 * @internal
	 */
	multipleChanged(prev, next) {
		this.ariaMultiSelectable = next ? "true" : null
	}
	/**
	 * Updates the list of selected options when the `selectedIndex` changes.
	 *
	 * @param prev - the previous selected index value
	 * @param next - the current selected index value
	 *
	 * @internal
	 */
	selectedIndexChanged(prev, next) {
		var _a
		if (!this.hasSelectableOptions) {
			this.selectedIndex = -1
			return
		}
		if (
			((_a = this.options[this.selectedIndex]) === null || _a === void 0 ? void 0 : _a.disabled) &&
			typeof prev === "number"
		) {
			const selectableIndex = this.getSelectableIndex(prev, next)
			const newNext = selectableIndex > -1 ? selectableIndex : prev
			this.selectedIndex = newNext
			if (next === newNext) {
				this.selectedIndexChanged(next, newNext)
			}
			return
		}
		this.setSelectedOptions()
	}
	/**
	 * Updates the selectedness of each option when the list of selected options changes.
	 *
	 * @param prev - the previous list of selected options
	 * @param next - the current list of selected options
	 *
	 * @internal
	 */
	selectedOptionsChanged(prev, next) {
		var _a
		const filteredNext = next.filter(Listbox.slottedOptionFilter)
		;(_a = this.options) === null || _a === void 0
			? void 0
			: _a.forEach((o) => {
					const notifier = Observable.getNotifier(o)
					notifier.unsubscribe(this, "selected")
					o.selected = filteredNext.includes(o)
					notifier.subscribe(this, "selected")
				})
	}
	/**
	 * Moves focus to the first selectable option.
	 *
	 * @public
	 */
	selectFirstOption() {
		var _a, _b
		if (!this.disabled) {
			this.selectedIndex =
				(_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.findIndex((o) => !o.disabled)) !== null &&
				_b !== void 0
					? _b
					: -1
		}
	}
	/**
	 * Moves focus to the last selectable option.
	 *
	 * @internal
	 */
	selectLastOption() {
		if (!this.disabled) {
			this.selectedIndex = findLastIndex(this.options, (o) => !o.disabled)
		}
	}
	/**
	 * Moves focus to the next selectable option.
	 *
	 * @internal
	 */
	selectNextOption() {
		if (!this.disabled && this.selectedIndex < this.options.length - 1) {
			this.selectedIndex += 1
		}
	}
	/**
	 * Moves focus to the previous selectable option.
	 *
	 * @internal
	 */
	selectPreviousOption() {
		if (!this.disabled && this.selectedIndex > 0) {
			this.selectedIndex = this.selectedIndex - 1
		}
	}
	/**
	 * Updates the selected index to match the first selected option.
	 *
	 * @internal
	 */
	setDefaultSelectedOption() {
		var _a, _b
		this.selectedIndex =
			(_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.findIndex((el) => el.defaultSelected)) !== null &&
			_b !== void 0
				? _b
				: -1
	}
	/**
	 * Sets an option as selected and gives it focus.
	 *
	 * @public
	 */
	setSelectedOptions() {
		var _a, _b, _c
		if ((_a = this.options) === null || _a === void 0 ? void 0 : _a.length) {
			this.selectedOptions = [this.options[this.selectedIndex]]
			this.ariaActiveDescendant =
				(_c = (_b = this.firstSelectedOption) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0
					? _c
					: ""
			this.focusAndScrollOptionIntoView()
		}
	}
	/**
	 * Updates the list of options and resets the selected option when the slotted option content changes.
	 *
	 * @param prev - the previous list of slotted options
	 * @param next - the current list of slotted options
	 *
	 * @internal
	 */
	slottedOptionsChanged(prev, next) {
		this.options = next.reduce((options, item) => {
			if (isListboxOption(item)) {
				options.push(item)
			}
			return options
		}, [])
		const setSize = `${this.options.length}`
		this.options.forEach((option, index) => {
			if (!option.id) {
				option.id = uniqueId("option-")
			}
			option.ariaPosInSet = `${index + 1}`
			option.ariaSetSize = setSize
		})
		if (this.$fastController.isConnected) {
			this.setSelectedOptions()
			this.setDefaultSelectedOption()
		}
	}
	/**
	 * Updates the filtered list of options when the typeahead buffer changes.
	 *
	 * @param prev - the previous typeahead buffer value
	 * @param next - the current typeahead buffer value
	 *
	 * @internal
	 */
	typeaheadBufferChanged(prev, next) {
		if (this.$fastController.isConnected) {
			const typeaheadMatches = this.getTypeaheadMatches()
			if (typeaheadMatches.length) {
				const selectedIndex = this.options.indexOf(typeaheadMatches[0])
				if (selectedIndex > -1) {
					this.selectedIndex = selectedIndex
				}
			}
			this.typeaheadExpired = false
		}
	}
}
/**
 * A static filter to include only selectable options.
 *
 * @param n - element to filter
 * @public
 */
Listbox.slottedOptionFilter = (n) => isListboxOption(n) && !n.hidden
/**
 * Typeahead timeout in milliseconds.
 *
 * @internal
 */
Listbox.TYPE_AHEAD_TIMEOUT_MS = 1000
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	Listbox.prototype,
	"disabled",
	void 0,
)
__decorate$1([observable], Listbox.prototype, "selectedIndex", void 0)
__decorate$1([observable], Listbox.prototype, "selectedOptions", void 0)
__decorate$1([observable], Listbox.prototype, "slottedOptions", void 0)
__decorate$1([observable], Listbox.prototype, "typeaheadBuffer", void 0)
/**
 * Includes ARIA states and properties relating to the ARIA listbox role
 *
 * @public
 */
class DelegatesARIAListbox {}
__decorate$1([observable], DelegatesARIAListbox.prototype, "ariaActiveDescendant", void 0)
__decorate$1([observable], DelegatesARIAListbox.prototype, "ariaDisabled", void 0)
__decorate$1([observable], DelegatesARIAListbox.prototype, "ariaExpanded", void 0)
__decorate$1([observable], DelegatesARIAListbox.prototype, "ariaMultiSelectable", void 0)
applyMixins(DelegatesARIAListbox, ARIAGlobalStatesAndProperties)
applyMixins(Listbox, DelegatesARIAListbox)

/**
 * Positioning directions for the listbox when a select is open.
 * @public
 */
const SelectPosition = {
	above: "above",
	below: "below",
}

/**
 * Retrieves the "composed parent" element of a node, ignoring DOM tree boundaries.
 * When the parent of a node is a shadow-root, it will return the host
 * element of the shadow root. Otherwise it will return the parent node or null if
 * no parent node exists.
 * @param element - The element for which to retrieve the composed parent
 *
 * @public
 */
function composedParent(element) {
	const parentNode = element.parentElement
	if (parentNode) {
		return parentNode
	} else {
		const rootNode = element.getRootNode()
		if (rootNode.host instanceof HTMLElement) {
			// this is shadow-root
			return rootNode.host
		}
	}
	return null
}

/**
 * Determines if the reference element contains the test element in a "composed" DOM tree that
 * ignores shadow DOM boundaries.
 *
 * Returns true of the test element is a descendent of the reference, or exist in
 * a shadow DOM that is a logical descendent of the reference. Otherwise returns false.
 * @param reference - The element to test for containment against.
 * @param test - The element being tested for containment.
 *
 * @public
 */
function composedContains(reference, test) {
	let current = test
	while (current !== null) {
		if (current === reference) {
			return true
		}
		current = composedParent(current)
	}
	return false
}

const defaultElement = document.createElement("div")
function isFastElement(element) {
	return element instanceof FASTElement
}
class QueuedStyleSheetTarget {
	setProperty(name, value) {
		DOM.queueUpdate(() => this.target.setProperty(name, value))
	}
	removeProperty(name) {
		DOM.queueUpdate(() => this.target.removeProperty(name))
	}
}
/**
 * Handles setting properties for a FASTElement using Constructable Stylesheets
 */
class ConstructableStyleSheetTarget extends QueuedStyleSheetTarget {
	constructor(source) {
		super()
		const sheet = new CSSStyleSheet()
		this.target = sheet.cssRules[sheet.insertRule(":host{}")].style
		source.$fastController.addStyles(ElementStyles.create([sheet]))
	}
}
class DocumentStyleSheetTarget extends QueuedStyleSheetTarget {
	constructor() {
		super()
		const sheet = new CSSStyleSheet()
		this.target = sheet.cssRules[sheet.insertRule(":root{}")].style
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
	}
}
class HeadStyleElementStyleSheetTarget extends QueuedStyleSheetTarget {
	constructor() {
		super()
		this.style = document.createElement("style")
		document.head.appendChild(this.style)
		const { sheet } = this.style
		// Because the HTMLStyleElement has been appended,
		// there shouldn't exist a case where `sheet` is null,
		// but if-check it just in case.
		if (sheet) {
			// https://github.com/jsdom/jsdom uses https://github.com/NV/CSSOM for it's CSSOM implementation,
			// which implements the DOM Level 2 spec for CSSStyleSheet where insertRule() requires an index argument.
			const index = sheet.insertRule(":root{}", sheet.cssRules.length)
			this.target = sheet.cssRules[index].style
		}
	}
}
/**
 * Handles setting properties for a FASTElement using an HTMLStyleElement
 */
class StyleElementStyleSheetTarget {
	constructor(target) {
		this.store = new Map()
		this.target = null
		const controller = target.$fastController
		this.style = document.createElement("style")
		controller.addStyles(this.style)
		Observable.getNotifier(controller).subscribe(this, "isConnected")
		this.handleChange(controller, "isConnected")
	}
	targetChanged() {
		if (this.target !== null) {
			for (const [key, value] of this.store.entries()) {
				this.target.setProperty(key, value)
			}
		}
	}
	setProperty(name, value) {
		this.store.set(name, value)
		DOM.queueUpdate(() => {
			if (this.target !== null) {
				this.target.setProperty(name, value)
			}
		})
	}
	removeProperty(name) {
		this.store.delete(name)
		DOM.queueUpdate(() => {
			if (this.target !== null) {
				this.target.removeProperty(name)
			}
		})
	}
	handleChange(source, key) {
		// HTMLStyleElement.sheet is null if the element isn't connected to the DOM,
		// so this method reacts to changes in DOM connection for the element hosting
		// the HTMLStyleElement.
		//
		// All rules applied via the CSSOM also get cleared when the element disconnects,
		// so we need to add a new rule each time and populate it with the stored properties
		const { sheet } = this.style
		if (sheet) {
			// Safari will throw if we try to use the return result of insertRule()
			// to index the rule inline, so store as a const prior to indexing.
			// https://github.com/jsdom/jsdom uses https://github.com/NV/CSSOM for it's CSSOM implementation,
			// which implements the DOM Level 2 spec for CSSStyleSheet where insertRule() requires an index argument.
			const index = sheet.insertRule(":host{}", sheet.cssRules.length)
			this.target = sheet.cssRules[index].style
		} else {
			this.target = null
		}
	}
}
__decorate$1([observable], StyleElementStyleSheetTarget.prototype, "target", void 0)
/**
 * Handles setting properties for a normal HTMLElement
 */
class ElementStyleSheetTarget {
	constructor(source) {
		this.target = source.style
	}
	setProperty(name, value) {
		DOM.queueUpdate(() => this.target.setProperty(name, value))
	}
	removeProperty(name) {
		DOM.queueUpdate(() => this.target.removeProperty(name))
	}
}
/**
 * Controls emission for default values. This control is capable
 * of emitting to multiple {@link PropertyTarget | PropertyTargets},
 * and only emits if it has at least one root.
 *
 * @internal
 */
class RootStyleSheetTarget {
	setProperty(name, value) {
		RootStyleSheetTarget.properties[name] = value
		for (const target of RootStyleSheetTarget.roots.values()) {
			PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(target)).setProperty(name, value)
		}
	}
	removeProperty(name) {
		delete RootStyleSheetTarget.properties[name]
		for (const target of RootStyleSheetTarget.roots.values()) {
			PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(target)).removeProperty(name)
		}
	}
	static registerRoot(root) {
		const { roots } = RootStyleSheetTarget
		if (!roots.has(root)) {
			roots.add(root)
			const target = PropertyTargetManager.getOrCreate(this.normalizeRoot(root))
			for (const key in RootStyleSheetTarget.properties) {
				target.setProperty(key, RootStyleSheetTarget.properties[key])
			}
		}
	}
	static unregisterRoot(root) {
		const { roots } = RootStyleSheetTarget
		if (roots.has(root)) {
			roots.delete(root)
			const target = PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(root))
			for (const key in RootStyleSheetTarget.properties) {
				target.removeProperty(key)
			}
		}
	}
	/**
	 * Returns the document when provided the default element,
	 * otherwise is a no-op
	 * @param root - the root to normalize
	 */
	static normalizeRoot(root) {
		return root === defaultElement ? document : root
	}
}
RootStyleSheetTarget.roots = new Set()
RootStyleSheetTarget.properties = {}
// Caches PropertyTarget instances
const propertyTargetCache = new WeakMap()
// Use Constructable StyleSheets for FAST elements when supported, otherwise use
// HTMLStyleElement instances
const propertyTargetCtor = DOM.supportsAdoptedStyleSheets ? ConstructableStyleSheetTarget : StyleElementStyleSheetTarget
/**
 * Manages creation and caching of PropertyTarget instances.
 *
 * @internal
 */
const PropertyTargetManager = Object.freeze({
	getOrCreate(source) {
		if (propertyTargetCache.has(source)) {
			/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
			return propertyTargetCache.get(source)
		}
		let target
		if (source === defaultElement) {
			target = new RootStyleSheetTarget()
		} else if (source instanceof Document) {
			target = DOM.supportsAdoptedStyleSheets ? new DocumentStyleSheetTarget() : new HeadStyleElementStyleSheetTarget()
		} else if (isFastElement(source)) {
			target = new propertyTargetCtor(source)
		} else {
			target = new ElementStyleSheetTarget(source)
		}
		propertyTargetCache.set(source, target)
		return target
	},
})

/**
 * Implementation of {@link (DesignToken:interface)}
 */
class DesignTokenImpl extends CSSDirective {
	constructor(configuration) {
		super()
		this.subscribers = new WeakMap()
		this._appliedTo = new Set()
		this.name = configuration.name
		if (configuration.cssCustomPropertyName !== null) {
			this.cssCustomProperty = `--${configuration.cssCustomPropertyName}`
			this.cssVar = `var(${this.cssCustomProperty})`
		}
		this.id = DesignTokenImpl.uniqueId()
		DesignTokenImpl.tokensById.set(this.id, this)
	}
	get appliedTo() {
		return [...this._appliedTo]
	}
	static from(nameOrConfig) {
		return new DesignTokenImpl({
			name: typeof nameOrConfig === "string" ? nameOrConfig : nameOrConfig.name,
			cssCustomPropertyName:
				typeof nameOrConfig === "string"
					? nameOrConfig
					: nameOrConfig.cssCustomPropertyName === void 0
						? nameOrConfig.name
						: nameOrConfig.cssCustomPropertyName,
		})
	}
	static isCSSDesignToken(token) {
		return typeof token.cssCustomProperty === "string"
	}
	static isDerivedDesignTokenValue(value) {
		return typeof value === "function"
	}
	/**
	 * Gets a token by ID. Returns undefined if the token was not found.
	 * @param id - The ID of the token
	 * @returns
	 */
	static getTokenById(id) {
		return DesignTokenImpl.tokensById.get(id)
	}
	getOrCreateSubscriberSet(target = this) {
		return this.subscribers.get(target) || (this.subscribers.set(target, new Set()) && this.subscribers.get(target))
	}
	createCSS() {
		return this.cssVar || ""
	}
	getValueFor(element) {
		const value = DesignTokenNode.getOrCreate(element).get(this)
		if (value !== undefined) {
			return value
		}
		throw new Error(
			`Value could not be retrieved for token named "${this.name}". Ensure the value is set for ${element} or an ancestor of ${element}.`,
		)
	}
	setValueFor(element, value) {
		this._appliedTo.add(element)
		if (value instanceof DesignTokenImpl) {
			value = this.alias(value)
		}
		DesignTokenNode.getOrCreate(element).set(this, value)
		return this
	}
	deleteValueFor(element) {
		this._appliedTo.delete(element)
		if (DesignTokenNode.existsFor(element)) {
			DesignTokenNode.getOrCreate(element).delete(this)
		}
		return this
	}
	withDefault(value) {
		this.setValueFor(defaultElement, value)
		return this
	}
	subscribe(subscriber, target) {
		const subscriberSet = this.getOrCreateSubscriberSet(target)
		if (target && !DesignTokenNode.existsFor(target)) {
			DesignTokenNode.getOrCreate(target)
		}
		if (!subscriberSet.has(subscriber)) {
			subscriberSet.add(subscriber)
		}
	}
	unsubscribe(subscriber, target) {
		const list = this.subscribers.get(target || this)
		if (list && list.has(subscriber)) {
			list.delete(subscriber)
		}
	}
	/**
	 * Notifies subscribers that the value for an element has changed.
	 * @param element - The element to emit a notification for
	 */
	notify(element) {
		const record = Object.freeze({
			token: this,
			target: element,
		})
		if (this.subscribers.has(this)) {
			this.subscribers.get(this).forEach((sub) => sub.handleChange(record))
		}
		if (this.subscribers.has(element)) {
			this.subscribers.get(element).forEach((sub) => sub.handleChange(record))
		}
	}
	/**
	 * Alias the token to the provided token.
	 * @param token - the token to alias to
	 */
	alias(token) {
		return (target) => token.getValueFor(target)
	}
}
DesignTokenImpl.uniqueId = (() => {
	let id = 0
	return () => {
		id++
		return id.toString(16)
	}
})()
/**
 * Token storage by token ID
 */
DesignTokenImpl.tokensById = new Map()
class CustomPropertyReflector {
	startReflection(token, target) {
		token.subscribe(this, target)
		this.handleChange({
			token,
			target,
		})
	}
	stopReflection(token, target) {
		token.unsubscribe(this, target)
		this.remove(token, target)
	}
	handleChange(record) {
		const { token, target } = record
		this.add(token, target)
	}
	add(token, target) {
		PropertyTargetManager.getOrCreate(target).setProperty(
			token.cssCustomProperty,
			this.resolveCSSValue(DesignTokenNode.getOrCreate(target).get(token)),
		)
	}
	remove(token, target) {
		PropertyTargetManager.getOrCreate(target).removeProperty(token.cssCustomProperty)
	}
	resolveCSSValue(value) {
		return value && typeof value.createCSS === "function" ? value.createCSS() : value
	}
}
/**
 * A light wrapper around BindingObserver to handle value caching and
 * token notification
 */
class DesignTokenBindingObserver {
	constructor(source, token, node) {
		this.source = source
		this.token = token
		this.node = node
		this.dependencies = new Set()
		this.observer = Observable.binding(source, this, false)
		// This is a little bit hacky because it's using internal APIs of BindingObserverImpl.
		// BindingObserverImpl queues updates to batch it's notifications which doesn't work for this
		// scenario because the DesignToken.getValueFor API is not async. Without this, using DesignToken.getValueFor()
		// after DesignToken.setValueFor() when setting a dependency of the value being retrieved can return a stale
		// value. Assigning .handleChange to .call forces immediate invocation of this classes handleChange() method,
		// allowing resolution of values synchronously.
		// TODO: https://github.com/microsoft/fast/issues/5110
		this.observer.handleChange = this.observer.call
		this.handleChange()
	}
	disconnect() {
		this.observer.disconnect()
	}
	/**
	 * @internal
	 */
	handleChange() {
		this.node.store.set(this.token, this.observer.observe(this.node.target, defaultExecutionContext))
	}
}
/**
 * Stores resolved token/value pairs and notifies on changes
 */
class Store {
	constructor() {
		this.values = new Map()
	}
	set(token, value) {
		if (this.values.get(token) !== value) {
			this.values.set(token, value)
			Observable.getNotifier(this).notify(token.id)
		}
	}
	get(token) {
		Observable.track(this, token.id)
		return this.values.get(token)
	}
	delete(token) {
		this.values.delete(token)
	}
	all() {
		return this.values.entries()
	}
}
const nodeCache = new WeakMap()
const childToParent = new WeakMap()
/**
 * A node responsible for setting and getting token values,
 * emitting values to CSS custom properties, and maintaining
 * inheritance structures.
 */
class DesignTokenNode {
	constructor(target) {
		this.target = target
		/**
		 * Stores all resolved token values for a node
		 */
		this.store = new Store()
		/**
		 * All children assigned to the node
		 */
		this.children = []
		/**
		 * All values explicitly assigned to the node in their raw form
		 */
		this.assignedValues = new Map()
		/**
		 * Tokens currently being reflected to CSS custom properties
		 */
		this.reflecting = new Set()
		/**
		 * Binding observers for assigned and inherited derived values.
		 */
		this.bindingObservers = new Map()
		/**
		 * Emits notifications to token when token values
		 * change the DesignTokenNode
		 */
		this.tokenValueChangeHandler = {
			handleChange: (source, arg) => {
				const token = DesignTokenImpl.getTokenById(arg)
				if (token) {
					// Notify any token subscribers
					token.notify(this.target)
					if (DesignTokenImpl.isCSSDesignToken(token)) {
						const parent = this.parent
						const reflecting = this.isReflecting(token)
						if (parent) {
							const parentValue = parent.get(token)
							const sourceValue = source.get(token)
							if (parentValue !== sourceValue && !reflecting) {
								this.reflectToCSS(token)
							} else if (parentValue === sourceValue && reflecting) {
								this.stopReflectToCSS(token)
							}
						} else if (!reflecting) {
							this.reflectToCSS(token)
						}
					}
				}
			},
		}
		nodeCache.set(target, this)
		// Map store change notifications to token change notifications
		Observable.getNotifier(this.store).subscribe(this.tokenValueChangeHandler)
		if (target instanceof FASTElement) {
			target.$fastController.addBehaviors([this])
		} else if (target.isConnected) {
			this.bind()
		}
	}
	/**
	 * Returns a DesignTokenNode for an element.
	 * Creates a new instance if one does not already exist for a node,
	 * otherwise returns the cached instance
	 *
	 * @param target - The HTML element to retrieve a DesignTokenNode for
	 */
	static getOrCreate(target) {
		return nodeCache.get(target) || new DesignTokenNode(target)
	}
	/**
	 * Determines if a DesignTokenNode has been created for a target
	 * @param target - The element to test
	 */
	static existsFor(target) {
		return nodeCache.has(target)
	}
	/**
	 * Searches for and return the nearest parent DesignTokenNode.
	 * Null is returned if no node is found or the node provided is for a default element.
	 */
	static findParent(node) {
		if (!(defaultElement === node.target)) {
			let parent = composedParent(node.target)
			while (parent !== null) {
				if (nodeCache.has(parent)) {
					return nodeCache.get(parent)
				}
				parent = composedParent(parent)
			}
			return DesignTokenNode.getOrCreate(defaultElement)
		}
		return null
	}
	/**
	 * Finds the closest node with a value explicitly assigned for a token, otherwise null.
	 * @param token - The token to look for
	 * @param start - The node to start looking for value assignment
	 * @returns
	 */
	static findClosestAssignedNode(token, start) {
		let current = start
		do {
			if (current.has(token)) {
				return current
			}
			current = current.parent
				? current.parent
				: current.target !== defaultElement
					? DesignTokenNode.getOrCreate(defaultElement)
					: null
		} while (current !== null)
		return null
	}
	/**
	 * The parent DesignTokenNode, or null.
	 */
	get parent() {
		return childToParent.get(this) || null
	}
	/**
	 * Checks if a token has been assigned an explicit value the node.
	 * @param token - the token to check.
	 */
	has(token) {
		return this.assignedValues.has(token)
	}
	/**
	 * Gets the value of a token for a node
	 * @param token - The token to retrieve the value for
	 * @returns
	 */
	get(token) {
		const value = this.store.get(token)
		if (value !== undefined) {
			return value
		}
		const raw = this.getRaw(token)
		if (raw !== undefined) {
			this.hydrate(token, raw)
			return this.get(token)
		}
	}
	/**
	 * Retrieves the raw assigned value of a token from the nearest assigned node.
	 * @param token - The token to retrieve a raw value for
	 * @returns
	 */
	getRaw(token) {
		var _a
		if (this.assignedValues.has(token)) {
			return this.assignedValues.get(token)
		}
		return (_a = DesignTokenNode.findClosestAssignedNode(token, this)) === null || _a === void 0 ? void 0 : _a.getRaw(token)
	}
	/**
	 * Sets a token to a value for a node
	 * @param token - The token to set
	 * @param value - The value to set the token to
	 */
	set(token, value) {
		if (DesignTokenImpl.isDerivedDesignTokenValue(this.assignedValues.get(token))) {
			this.tearDownBindingObserver(token)
		}
		this.assignedValues.set(token, value)
		if (DesignTokenImpl.isDerivedDesignTokenValue(value)) {
			this.setupBindingObserver(token, value)
		} else {
			this.store.set(token, value)
		}
	}
	/**
	 * Deletes a token value for the node.
	 * @param token - The token to delete the value for
	 */
	delete(token) {
		this.assignedValues.delete(token)
		this.tearDownBindingObserver(token)
		const upstream = this.getRaw(token)
		if (upstream) {
			this.hydrate(token, upstream)
		} else {
			this.store.delete(token)
		}
	}
	/**
	 * Invoked when the DesignTokenNode.target is attached to the document
	 */
	bind() {
		const parent = DesignTokenNode.findParent(this)
		if (parent) {
			parent.appendChild(this)
		}
		for (const key of this.assignedValues.keys()) {
			key.notify(this.target)
		}
	}
	/**
	 * Invoked when the DesignTokenNode.target is detached from the document
	 */
	unbind() {
		if (this.parent) {
			const parent = childToParent.get(this)
			parent.removeChild(this)
		}
	}
	/**
	 * Appends a child to a parent DesignTokenNode.
	 * @param child - The child to append to the node
	 */
	appendChild(child) {
		if (child.parent) {
			childToParent.get(child).removeChild(child)
		}
		const reParent = this.children.filter((x) => child.contains(x))
		childToParent.set(child, this)
		this.children.push(child)
		reParent.forEach((x) => child.appendChild(x))
		Observable.getNotifier(this.store).subscribe(child)
		// How can we not notify *every* subscriber?
		for (const [token, value] of this.store.all()) {
			child.hydrate(token, this.bindingObservers.has(token) ? this.getRaw(token) : value)
		}
	}
	/**
	 * Removes a child from a node.
	 * @param child - The child to remove.
	 */
	removeChild(child) {
		const childIndex = this.children.indexOf(child)
		if (childIndex !== -1) {
			this.children.splice(childIndex, 1)
		}
		Observable.getNotifier(this.store).unsubscribe(child)
		return child.parent === this ? childToParent.delete(child) : false
	}
	/**
	 * Tests whether a provided node is contained by
	 * the calling node.
	 * @param test - The node to test
	 */
	contains(test) {
		return composedContains(this.target, test.target)
	}
	/**
	 * Instructs the node to reflect a design token for the provided token.
	 * @param token - The design token to reflect
	 */
	reflectToCSS(token) {
		if (!this.isReflecting(token)) {
			this.reflecting.add(token)
			DesignTokenNode.cssCustomPropertyReflector.startReflection(token, this.target)
		}
	}
	/**
	 * Stops reflecting a DesignToken to CSS
	 * @param token - The design token to stop reflecting
	 */
	stopReflectToCSS(token) {
		if (this.isReflecting(token)) {
			this.reflecting.delete(token)
			DesignTokenNode.cssCustomPropertyReflector.stopReflection(token, this.target)
		}
	}
	/**
	 * Determines if a token is being reflected to CSS for a node.
	 * @param token - The token to check for reflection
	 * @returns
	 */
	isReflecting(token) {
		return this.reflecting.has(token)
	}
	/**
	 * Handle changes to upstream tokens
	 * @param source - The parent DesignTokenNode
	 * @param property - The token ID that changed
	 */
	handleChange(source, property) {
		const token = DesignTokenImpl.getTokenById(property)
		if (!token) {
			return
		}
		this.hydrate(token, this.getRaw(token))
	}
	/**
	 * Hydrates a token with a DesignTokenValue, making retrieval available.
	 * @param token - The token to hydrate
	 * @param value - The value to hydrate
	 */
	hydrate(token, value) {
		if (!this.has(token)) {
			const observer = this.bindingObservers.get(token)
			if (DesignTokenImpl.isDerivedDesignTokenValue(value)) {
				if (observer) {
					// If the binding source doesn't match, we need
					// to update the binding
					if (observer.source !== value) {
						this.tearDownBindingObserver(token)
						this.setupBindingObserver(token, value)
					}
				} else {
					this.setupBindingObserver(token, value)
				}
			} else {
				if (observer) {
					this.tearDownBindingObserver(token)
				}
				this.store.set(token, value)
			}
		}
	}
	/**
	 * Sets up a binding observer for a derived token value that notifies token
	 * subscribers on change.
	 *
	 * @param token - The token to notify when the binding updates
	 * @param source - The binding source
	 */
	setupBindingObserver(token, source) {
		const binding = new DesignTokenBindingObserver(source, token, this)
		this.bindingObservers.set(token, binding)
		return binding
	}
	/**
	 * Tear down a binding observer for a token.
	 */
	tearDownBindingObserver(token) {
		if (this.bindingObservers.has(token)) {
			this.bindingObservers.get(token).disconnect()
			this.bindingObservers.delete(token)
			return true
		}
		return false
	}
}
/**
 * Responsible for reflecting tokens to CSS custom properties
 */
DesignTokenNode.cssCustomPropertyReflector = new CustomPropertyReflector()
__decorate$1([observable], DesignTokenNode.prototype, "children", void 0)
function create$1(nameOrConfig) {
	return DesignTokenImpl.from(nameOrConfig)
}
/* eslint-enable @typescript-eslint/no-unused-vars */
/**
 * Factory object for creating {@link (DesignToken:interface)} instances.
 * @public
 */
const DesignToken = Object.freeze({
	create: create$1,
	/**
	 * Informs DesignToken that an HTMLElement for which tokens have
	 * been set has been connected to the document.
	 *
	 * The browser does not provide a reliable mechanism to observe an HTMLElement's connectedness
	 * in all scenarios, so invoking this method manually is necessary when:
	 *
	 * 1. Token values are set for an HTMLElement.
	 * 2. The HTMLElement does not inherit from FASTElement.
	 * 3. The HTMLElement is not connected to the document when token values are set.
	 *
	 * @param element - The element to notify
	 * @returns - true if notification was successful, otherwise false.
	 */
	notifyConnection(element) {
		if (!element.isConnected || !DesignTokenNode.existsFor(element)) {
			return false
		}
		DesignTokenNode.getOrCreate(element).bind()
		return true
	},
	/**
	 * Informs DesignToken that an HTMLElement for which tokens have
	 * been set has been disconnected to the document.
	 *
	 * The browser does not provide a reliable mechanism to observe an HTMLElement's connectedness
	 * in all scenarios, so invoking this method manually is necessary when:
	 *
	 * 1. Token values are set for an HTMLElement.
	 * 2. The HTMLElement does not inherit from FASTElement.
	 *
	 * @param element - The element to notify
	 * @returns - true if notification was successful, otherwise false.
	 */
	notifyDisconnection(element) {
		if (element.isConnected || !DesignTokenNode.existsFor(element)) {
			return false
		}
		DesignTokenNode.getOrCreate(element).unbind()
		return true
	},
	/**
	 * Registers and element or document as a DesignToken root.
	 * {@link CSSDesignToken | CSSDesignTokens} with default values assigned via
	 * {@link (DesignToken:interface).withDefault} will emit CSS custom properties to all
	 * registered roots.
	 * @param target - The root to register
	 */
	registerRoot(target = defaultElement) {
		RootStyleSheetTarget.registerRoot(target)
	},
	/**
	 * Unregister an element or document as a DesignToken root.
	 * @param target - The root to deregister
	 */
	unregisterRoot(target = defaultElement) {
		RootStyleSheetTarget.unregisterRoot(target)
	},
})
/* eslint-enable @typescript-eslint/no-non-null-assertion */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Indicates what to do with an ambiguous (duplicate) element.
 * @public
 */
const ElementDisambiguation = Object.freeze({
	/**
	 * Skip defining the element but still call the provided callback passed
	 * to DesignSystemRegistrationContext.tryDefineElement
	 */
	definitionCallbackOnly: null,
	/**
	 * Ignore the duplicate element entirely.
	 */
	ignoreDuplicate: Symbol(),
})
const elementTypesByTag = new Map()
const elementTagsByType = new Map()
let rootDesignSystem = null
const designSystemKey = DI.createInterface((x) =>
	x.cachedCallback((handler) => {
		if (rootDesignSystem === null) {
			rootDesignSystem = new DefaultDesignSystem(null, handler)
		}
		return rootDesignSystem
	}),
)
/**
 * An API gateway to design system features.
 * @public
 */
const DesignSystem = Object.freeze({
	/**
	 * Returns the HTML element name that the type is defined as.
	 * @param type - The type to lookup.
	 * @public
	 */
	tagFor(type) {
		return elementTagsByType.get(type)
	},
	/**
	 * Searches the DOM hierarchy for the design system that is responsible
	 * for the provided element.
	 * @param element - The element to locate the design system for.
	 * @returns The located design system.
	 * @public
	 */
	responsibleFor(element) {
		const owned = element.$$designSystem$$
		if (owned) {
			return owned
		}
		const container = DI.findResponsibleContainer(element)
		return container.get(designSystemKey)
	},
	/**
	 * Gets the DesignSystem if one is explicitly defined on the provided element;
	 * otherwise creates a design system defined directly on the element.
	 * @param element - The element to get or create a design system for.
	 * @returns The design system.
	 * @public
	 */
	getOrCreate(node) {
		if (!node) {
			if (rootDesignSystem === null) {
				rootDesignSystem = DI.getOrCreateDOMContainer().get(designSystemKey)
			}
			return rootDesignSystem
		}
		const owned = node.$$designSystem$$
		if (owned) {
			return owned
		}
		const container = DI.getOrCreateDOMContainer(node)
		if (container.has(designSystemKey, false)) {
			return container.get(designSystemKey)
		} else {
			const system = new DefaultDesignSystem(node, container)
			container.register(Registration.instance(designSystemKey, system))
			return system
		}
	},
})
function extractTryDefineElementParams(params, elementDefinitionType, elementDefinitionCallback) {
	if (typeof params === "string") {
		return {
			name: params,
			type: elementDefinitionType,
			callback: elementDefinitionCallback,
		}
	} else {
		return params
	}
}
class DefaultDesignSystem {
	constructor(owner, container) {
		this.owner = owner
		this.container = container
		this.designTokensInitialized = false
		this.prefix = "fast"
		this.shadowRootMode = undefined
		this.disambiguate = () => ElementDisambiguation.definitionCallbackOnly
		if (owner !== null) {
			owner.$$designSystem$$ = this
		}
	}
	withPrefix(prefix) {
		this.prefix = prefix
		return this
	}
	withShadowRootMode(mode) {
		this.shadowRootMode = mode
		return this
	}
	withElementDisambiguation(callback) {
		this.disambiguate = callback
		return this
	}
	withDesignTokenRoot(root) {
		this.designTokenRoot = root
		return this
	}
	register(...registrations) {
		const container = this.container
		const elementDefinitionEntries = []
		const disambiguate = this.disambiguate
		const shadowRootMode = this.shadowRootMode
		const context = {
			elementPrefix: this.prefix,
			tryDefineElement(params, elementDefinitionType, elementDefinitionCallback) {
				const extractedParams = extractTryDefineElementParams(params, elementDefinitionType, elementDefinitionCallback)
				const { name, callback, baseClass } = extractedParams
				let { type } = extractedParams
				let elementName = name
				let typeFoundByName = elementTypesByTag.get(elementName)
				let needsDefine = true
				while (typeFoundByName) {
					const result = disambiguate(elementName, type, typeFoundByName)
					switch (result) {
						case ElementDisambiguation.ignoreDuplicate:
							return
						case ElementDisambiguation.definitionCallbackOnly:
							needsDefine = false
							typeFoundByName = void 0
							break
						default:
							elementName = result
							typeFoundByName = elementTypesByTag.get(elementName)
							break
					}
				}
				if (needsDefine) {
					if (elementTagsByType.has(type) || type === FoundationElement) {
						type = class extends type {}
					}
					elementTypesByTag.set(elementName, type)
					elementTagsByType.set(type, elementName)
					if (baseClass) {
						elementTagsByType.set(baseClass, elementName)
					}
				}
				elementDefinitionEntries.push(
					new ElementDefinitionEntry(container, elementName, type, shadowRootMode, callback, needsDefine),
				)
			},
		}
		if (!this.designTokensInitialized) {
			this.designTokensInitialized = true
			if (this.designTokenRoot !== null) {
				DesignToken.registerRoot(this.designTokenRoot)
			}
		}
		container.registerWithContext(context, ...registrations)
		for (const entry of elementDefinitionEntries) {
			entry.callback(entry)
			if (entry.willDefine && entry.definition !== null) {
				entry.definition.define()
			}
		}
		return this
	}
}
class ElementDefinitionEntry {
	constructor(container, name, type, shadowRootMode, callback, willDefine) {
		this.container = container
		this.name = name
		this.type = type
		this.shadowRootMode = shadowRootMode
		this.callback = callback
		this.willDefine = willDefine
		this.definition = null
	}
	definePresentation(presentation) {
		ComponentPresentation.define(this.name, presentation, this.container)
	}
	defineElement(definition) {
		this.definition = new FASTElementDefinition(
			this.type,
			Object.assign(Object.assign({}, definition), {
				name: this.name,
			}),
		)
	}
	tagFor(type) {
		return DesignSystem.tagFor(type)
	}
}
/* eslint-enable @typescript-eslint/no-non-null-assertion */

/**
 * The template for the {@link @microsoft/fast-foundation#Divider} component.
 * @public
 */
const dividerTemplate = (context, definition) =>
	html`<template role="${(x) => x.role}" aria-orientation="${(x) => x.orientation}"></template>`

/**
 * Divider roles
 * @public
 */
const DividerRole = {
	/**
	 * The divider semantically separates content
	 */
	separator: "separator",
	/**
	 * The divider has no semantic value and is for visual presentation only.
	 */
	presentation: "presentation",
}

/**
 * A Divider Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#separator | ARIA separator } or {@link https://www.w3.org/TR/wai-aria-1.1/#presentation | ARIA presentation}.
 *
 * @public
 */
class Divider$1 extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * The role of the element.
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: role
		 */
		this.role = DividerRole.separator
		/**
		 * The orientation of the divider.
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: orientation
		 */
		this.orientation = Orientation.horizontal
	}
}
__decorate$1([attr], Divider$1.prototype, "role", void 0)
__decorate$1([attr], Divider$1.prototype, "orientation", void 0)

/**
 * The template for the {@link @microsoft/fast-foundation#(ListboxOption:class)} component.
 * @public
 */
const listboxOptionTemplate = (context, definition) =>
	html`<template
		aria-checked="${(x) => x.ariaChecked}"
		aria-disabled="${(x) => x.ariaDisabled}"
		aria-posinset="${(x) => x.ariaPosInSet}"
		aria-selected="${(x) => x.ariaSelected}"
		aria-setsize="${(x) => x.ariaSetSize}"
		class="${(x) => [x.checked && "checked", x.selected && "selected", x.disabled && "disabled"].filter(Boolean).join(" ")}"
		role="option"
		>${startSlotTemplate(context, definition)}<span class="content" part="content"><slot ${slotted("content")}></slot></span
		>${endSlotTemplate(context, definition)}</template
	>`

/**
 * A Listbox Custom HTML Element.
 * Implements the {@link https://w3c.github.io/aria/#listbox | ARIA listbox }.
 *
 * @public
 */
class ListboxElement extends Listbox {
	constructor() {
		super(...arguments)
		/**
		 * The index of the most recently checked option.
		 *
		 * @internal
		 * @remarks
		 * Multiple-selection mode only.
		 */
		this.activeIndex = -1
		/**
		 * The start index when checking a range of options.
		 *
		 * @internal
		 */
		this.rangeStartIndex = -1
	}
	/**
	 * Returns the last checked option.
	 *
	 * @internal
	 */
	get activeOption() {
		return this.options[this.activeIndex]
	}
	/**
	 * Returns the list of checked options.
	 *
	 * @internal
	 */
	get checkedOptions() {
		var _a
		return (_a = this.options) === null || _a === void 0 ? void 0 : _a.filter((o) => o.checked)
	}
	/**
	 * Returns the index of the first selected option.
	 *
	 * @internal
	 */
	get firstSelectedOptionIndex() {
		return this.options.indexOf(this.firstSelectedOption)
	}
	/**
	 * Updates the `ariaActiveDescendant` property when the active index changes.
	 *
	 * @param prev - the previous active index
	 * @param next - the next active index
	 *
	 * @internal
	 */
	activeIndexChanged(prev, next) {
		var _a, _b
		this.ariaActiveDescendant =
			(_b = (_a = this.options[next]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : ""
		this.focusAndScrollOptionIntoView()
	}
	/**
	 * Toggles the checked state for the currently active option.
	 *
	 * @remarks
	 * Multiple-selection mode only.
	 *
	 * @internal
	 */
	checkActiveIndex() {
		if (!this.multiple) {
			return
		}
		const activeItem = this.activeOption
		if (activeItem) {
			activeItem.checked = true
		}
	}
	/**
	 * Sets the active index to the first option and marks it as checked.
	 *
	 * @remarks
	 * Multi-selection mode only.
	 *
	 * @param preserveChecked - mark all options unchecked before changing the active index
	 *
	 * @internal
	 */
	checkFirstOption(preserveChecked = false) {
		if (preserveChecked) {
			if (this.rangeStartIndex === -1) {
				this.rangeStartIndex = this.activeIndex + 1
			}
			this.options.forEach((o, i) => {
				o.checked = inRange(i, this.rangeStartIndex)
			})
		} else {
			this.uncheckAllOptions()
		}
		this.activeIndex = 0
		this.checkActiveIndex()
	}
	/**
	 * Decrements the active index and sets the matching option as checked.
	 *
	 * @remarks
	 * Multi-selection mode only.
	 *
	 * @param preserveChecked - mark all options unchecked before changing the active index
	 *
	 * @internal
	 */
	checkLastOption(preserveChecked = false) {
		if (preserveChecked) {
			if (this.rangeStartIndex === -1) {
				this.rangeStartIndex = this.activeIndex
			}
			this.options.forEach((o, i) => {
				o.checked = inRange(i, this.rangeStartIndex, this.options.length)
			})
		} else {
			this.uncheckAllOptions()
		}
		this.activeIndex = this.options.length - 1
		this.checkActiveIndex()
	}
	/**
	 * @override
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		this.addEventListener("focusout", this.focusoutHandler)
	}
	/**
	 * @override
	 * @internal
	 */
	disconnectedCallback() {
		this.removeEventListener("focusout", this.focusoutHandler)
		super.disconnectedCallback()
	}
	/**
	 * Increments the active index and marks the matching option as checked.
	 *
	 * @remarks
	 * Multiple-selection mode only.
	 *
	 * @param preserveChecked - mark all options unchecked before changing the active index
	 *
	 * @internal
	 */
	checkNextOption(preserveChecked = false) {
		if (preserveChecked) {
			if (this.rangeStartIndex === -1) {
				this.rangeStartIndex = this.activeIndex
			}
			this.options.forEach((o, i) => {
				o.checked = inRange(i, this.rangeStartIndex, this.activeIndex + 1)
			})
		} else {
			this.uncheckAllOptions()
		}
		this.activeIndex += this.activeIndex < this.options.length - 1 ? 1 : 0
		this.checkActiveIndex()
	}
	/**
	 * Decrements the active index and marks the matching option as checked.
	 *
	 * @remarks
	 * Multiple-selection mode only.
	 *
	 * @param preserveChecked - mark all options unchecked before changing the active index
	 *
	 * @internal
	 */
	checkPreviousOption(preserveChecked = false) {
		if (preserveChecked) {
			if (this.rangeStartIndex === -1) {
				this.rangeStartIndex = this.activeIndex
			}
			if (this.checkedOptions.length === 1) {
				this.rangeStartIndex += 1
			}
			this.options.forEach((o, i) => {
				o.checked = inRange(i, this.activeIndex, this.rangeStartIndex)
			})
		} else {
			this.uncheckAllOptions()
		}
		this.activeIndex -= this.activeIndex > 0 ? 1 : 0
		this.checkActiveIndex()
	}
	/**
	 * Handles click events for listbox options.
	 *
	 * @param e - the event object
	 *
	 * @override
	 * @internal
	 */
	clickHandler(e) {
		var _a
		if (!this.multiple) {
			return super.clickHandler(e)
		}
		const captured = (_a = e.target) === null || _a === void 0 ? void 0 : _a.closest(`[role=option]`)
		if (!captured || captured.disabled) {
			return
		}
		this.uncheckAllOptions()
		this.activeIndex = this.options.indexOf(captured)
		this.checkActiveIndex()
		this.toggleSelectedForAllCheckedOptions()
		return true
	}
	/**
	 * @override
	 * @internal
	 */
	focusAndScrollOptionIntoView() {
		super.focusAndScrollOptionIntoView(this.activeOption)
	}
	/**
	 * In multiple-selection mode:
	 * If any options are selected, the first selected option is checked when
	 * the listbox receives focus. If no options are selected, the first
	 * selectable option is checked.
	 *
	 * @override
	 * @internal
	 */
	focusinHandler(e) {
		if (!this.multiple) {
			return super.focusinHandler(e)
		}
		if (!this.shouldSkipFocus && e.target === e.currentTarget) {
			this.uncheckAllOptions()
			if (this.activeIndex === -1) {
				this.activeIndex = this.firstSelectedOptionIndex !== -1 ? this.firstSelectedOptionIndex : 0
			}
			this.checkActiveIndex()
			this.setSelectedOptions()
			this.focusAndScrollOptionIntoView()
		}
		this.shouldSkipFocus = false
	}
	/**
	 * Unchecks all options when the listbox loses focus.
	 *
	 * @internal
	 */
	focusoutHandler(e) {
		if (this.multiple) {
			this.uncheckAllOptions()
		}
	}
	/**
	 * Handles keydown actions for listbox navigation and typeahead
	 *
	 * @override
	 * @internal
	 */
	keydownHandler(e) {
		if (!this.multiple) {
			return super.keydownHandler(e)
		}
		if (this.disabled) {
			return true
		}
		const { key, shiftKey } = e
		this.shouldSkipFocus = false
		switch (key) {
			// Select the first available option
			case keyHome: {
				this.checkFirstOption(shiftKey)
				return
			}
			// Select the next selectable option
			case keyArrowDown: {
				this.checkNextOption(shiftKey)
				return
			}
			// Select the previous selectable option
			case keyArrowUp: {
				this.checkPreviousOption(shiftKey)
				return
			}
			// Select the last available option
			case keyEnd: {
				this.checkLastOption(shiftKey)
				return
			}
			case keyTab: {
				this.focusAndScrollOptionIntoView()
				return true
			}
			case keyEscape: {
				this.uncheckAllOptions()
				this.checkActiveIndex()
				return true
			}
			case keySpace: {
				e.preventDefault()
				if (this.typeAheadExpired) {
					this.toggleSelectedForAllCheckedOptions()
					return
				}
			}
			// Send key to Typeahead handler
			default: {
				if (key.length === 1) {
					this.handleTypeAhead(`${key}`)
				}
				return true
			}
		}
	}
	/**
	 * Prevents `focusin` events from firing before `click` events when the
	 * element is unfocused.
	 *
	 * @override
	 * @internal
	 */
	mousedownHandler(e) {
		if (e.offsetX >= 0 && e.offsetX <= this.scrollWidth) {
			return super.mousedownHandler(e)
		}
	}
	/**
	 * Switches between single-selection and multi-selection mode.
	 *
	 * @internal
	 */
	multipleChanged(prev, next) {
		var _a
		this.ariaMultiSelectable = next ? "true" : null
		;(_a = this.options) === null || _a === void 0
			? void 0
			: _a.forEach((o) => {
					o.checked = next ? false : undefined
				})
		this.setSelectedOptions()
	}
	/**
	 * Sets an option as selected and gives it focus.
	 *
	 * @override
	 * @public
	 */
	setSelectedOptions() {
		if (!this.multiple) {
			super.setSelectedOptions()
			return
		}
		if (this.$fastController.isConnected && this.options) {
			this.selectedOptions = this.options.filter((o) => o.selected)
			this.focusAndScrollOptionIntoView()
		}
	}
	/**
	 * Ensures the size is a positive integer when the property is updated.
	 *
	 * @param prev - the previous size value
	 * @param next - the current size value
	 *
	 * @internal
	 */
	sizeChanged(prev, next) {
		var _a
		const size = Math.max(
			0,
			parseInt((_a = next === null || next === void 0 ? void 0 : next.toFixed()) !== null && _a !== void 0 ? _a : "", 10),
		)
		if (size !== next) {
			DOM.queueUpdate(() => {
				this.size = size
			})
		}
	}
	/**
	 * Toggles the selected state of the provided options. If any provided items
	 * are in an unselected state, all items are set to selected. If every
	 * provided item is selected, they are all unselected.
	 *
	 * @internal
	 */
	toggleSelectedForAllCheckedOptions() {
		const enabledCheckedOptions = this.checkedOptions.filter((o) => !o.disabled)
		const force = !enabledCheckedOptions.every((o) => o.selected)
		enabledCheckedOptions.forEach((o) => (o.selected = force))
		this.selectedIndex = this.options.indexOf(enabledCheckedOptions[enabledCheckedOptions.length - 1])
		this.setSelectedOptions()
	}
	/**
	 * @override
	 * @internal
	 */
	typeaheadBufferChanged(prev, next) {
		if (!this.multiple) {
			super.typeaheadBufferChanged(prev, next)
			return
		}
		if (this.$fastController.isConnected) {
			const typeaheadMatches = this.getTypeaheadMatches()
			const activeIndex = this.options.indexOf(typeaheadMatches[0])
			if (activeIndex > -1) {
				this.activeIndex = activeIndex
				this.uncheckAllOptions()
				this.checkActiveIndex()
			}
			this.typeAheadExpired = false
		}
	}
	/**
	 * Unchecks all options.
	 *
	 * @remarks
	 * Multiple-selection mode only.
	 *
	 * @param preserveChecked - reset the rangeStartIndex
	 *
	 * @internal
	 */
	uncheckAllOptions(preserveChecked = false) {
		this.options.forEach((o) => (o.checked = this.multiple ? false : undefined))
		if (!preserveChecked) {
			this.rangeStartIndex = -1
		}
	}
}
__decorate$1([observable], ListboxElement.prototype, "activeIndex", void 0)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	ListboxElement.prototype,
	"multiple",
	void 0,
)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	ListboxElement.prototype,
	"size",
	void 0,
)

class _TextField extends FoundationElement {}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(TextField:class)} component.
 *
 * @internal
 */
class FormAssociatedTextField extends FormAssociated(_TextField) {
	constructor() {
		super(...arguments)
		this.proxy = document.createElement("input")
	}
}

/**
 * Text field sub-types
 * @public
 */
const TextFieldType = {
	/**
	 * An email TextField
	 */
	email: "email",
	/**
	 * A password TextField
	 */
	password: "password",
	/**
	 * A telephone TextField
	 */
	tel: "tel",
	/**
	 * A text TextField
	 */
	text: "text",
	/**
	 * A URL TextField
	 */
	url: "url",
}

/**
 * A Text Field Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/text | <input type="text" /> element }.
 *
 * @slot start - Content which can be provided before the number field input
 * @slot end - Content which can be provided after the number field input
 * @slot - The default slot for the label
 * @csspart label - The label
 * @csspart root - The element wrapping the control, including start and end slots
 * @csspart control - The text field element
 * @fires change - Fires a custom 'change' event when the value has changed
 *
 * @public
 */
class TextField$1 extends FormAssociatedTextField {
	constructor() {
		super(...arguments)
		/**
		 * Allows setting a type or mode of text.
		 * @public
		 * @remarks
		 * HTML Attribute: type
		 */
		this.type = TextFieldType.text
	}
	readOnlyChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.readOnly = this.readOnly
			this.validate()
		}
	}
	autofocusChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.autofocus = this.autofocus
			this.validate()
		}
	}
	placeholderChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.placeholder = this.placeholder
		}
	}
	typeChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.type = this.type
			this.validate()
		}
	}
	listChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.setAttribute("list", this.list)
			this.validate()
		}
	}
	maxlengthChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.maxLength = this.maxlength
			this.validate()
		}
	}
	minlengthChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.minLength = this.minlength
			this.validate()
		}
	}
	patternChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.pattern = this.pattern
			this.validate()
		}
	}
	sizeChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.size = this.size
		}
	}
	spellcheckChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.spellcheck = this.spellcheck
		}
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		this.proxy.setAttribute("type", this.type)
		this.validate()
		if (this.autofocus) {
			DOM.queueUpdate(() => {
				this.focus()
			})
		}
	}
	/**
	 * Selects all the text in the text field
	 *
	 * @public
	 */
	select() {
		this.control.select()
		/**
		 * The select event does not permeate the shadow DOM boundary.
		 * This fn effectively proxies the select event,
		 * emitting a `select` event whenever the internal
		 * control emits a `select` event
		 */
		this.$emit("select")
	}
	/**
	 * Handles the internal control's `input` event
	 * @internal
	 */
	handleTextInput() {
		this.value = this.control.value
	}
	/**
	 * Change event handler for inner control.
	 * @remarks
	 * "Change" events are not `composable` so they will not
	 * permeate the shadow DOM boundary. This fn effectively proxies
	 * the change event, emitting a `change` event whenever the internal
	 * control emits a `change` event
	 * @internal
	 */
	handleChange() {
		this.$emit("change")
	}
	/** {@inheritDoc (FormAssociated:interface).validate} */
	validate() {
		super.validate(this.control)
	}
}
__decorate$1(
	[
		attr({
			attribute: "readonly",
			mode: "boolean",
		}),
	],
	TextField$1.prototype,
	"readOnly",
	void 0,
)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	TextField$1.prototype,
	"autofocus",
	void 0,
)
__decorate$1([attr], TextField$1.prototype, "placeholder", void 0)
__decorate$1([attr], TextField$1.prototype, "type", void 0)
__decorate$1([attr], TextField$1.prototype, "list", void 0)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	TextField$1.prototype,
	"maxlength",
	void 0,
)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	TextField$1.prototype,
	"minlength",
	void 0,
)
__decorate$1([attr], TextField$1.prototype, "pattern", void 0)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	TextField$1.prototype,
	"size",
	void 0,
)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	TextField$1.prototype,
	"spellcheck",
	void 0,
)
__decorate$1([observable], TextField$1.prototype, "defaultSlottedNodes", void 0)
/**
 * Includes ARIA states and properties relating to the ARIA textbox role
 *
 * @public
 */
class DelegatesARIATextbox {}
applyMixins(DelegatesARIATextbox, ARIAGlobalStatesAndProperties)
applyMixins(TextField$1, StartEnd, DelegatesARIATextbox)

const progressSegments = 44
/**
 * The template for the {@link @microsoft/fast-foundation#BaseProgress} component.
 * @public
 */
const progressRingTemplate = (context, definition) =>
	html`<template
		role="progressbar"
		aria-valuenow="${(x) => x.value}"
		aria-valuemin="${(x) => x.min}"
		aria-valuemax="${(x) => x.max}"
		class="${(x) => (x.paused ? "paused" : "")}"
		>${when(
			(x) => typeof x.value === "number",
			html`<svg class="progress" part="progress" viewBox="0 0 16 16" slot="determinate">
				<circle class="background" part="background" cx="8px" cy="8px" r="7px"></circle>
				<circle
					class="determinate"
					part="determinate"
					style="stroke-dasharray: ${(x) => (progressSegments * x.percentComplete) / 100}px ${progressSegments}px"
					cx="8px"
					cy="8px"
					r="7px"></circle>
			</svg>`,
			html`<slot name="indeterminate" slot="indeterminate">${definition.indeterminateIndicator || ""}</slot>`,
		)}</template
	>`

/**
 * An Progress HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#progressbar | ARIA progressbar }.
 *
 * @slot indeterminate - The slot for a custom indeterminate indicator
 * @csspart progress - Represents the progress element
 * @csspart determinate - The determinate indicator
 * @csspart indeterminate - The indeterminate indicator
 *
 * @public
 */
class BaseProgress extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * Indicates progress in %
		 * @internal
		 */
		this.percentComplete = 0
	}
	valueChanged() {
		if (this.$fastController.isConnected) {
			this.updatePercentComplete()
		}
	}
	minChanged() {
		if (this.$fastController.isConnected) {
			this.updatePercentComplete()
		}
	}
	maxChanged() {
		if (this.$fastController.isConnected) {
			this.updatePercentComplete()
		}
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		this.updatePercentComplete()
	}
	updatePercentComplete() {
		const min = typeof this.min === "number" ? this.min : 0
		const max = typeof this.max === "number" ? this.max : 100
		const value = typeof this.value === "number" ? this.value : 0
		const range = max - min
		this.percentComplete = range === 0 ? 0 : Math.fround(((value - min) / range) * 100)
	}
}
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	BaseProgress.prototype,
	"value",
	void 0,
)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	BaseProgress.prototype,
	"min",
	void 0,
)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	BaseProgress.prototype,
	"max",
	void 0,
)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	BaseProgress.prototype,
	"paused",
	void 0,
)
__decorate$1([observable], BaseProgress.prototype, "percentComplete", void 0)

/**
 * The template for the {@link @microsoft/fast-foundation#RadioGroup} component.
 * @public
 */
const radioGroupTemplate = (context, definition) =>
	html`<template
		role="radiogroup"
		aria-disabled="${(x) => x.disabled}"
		aria-readonly="${(x) => x.readOnly}"
		@click="${(x, c) => x.clickHandler(c.event)}"
		@keydown="${(x, c) => x.keydownHandler(c.event)}"
		@focusout="${(x, c) => x.focusOutHandler(c.event)}"
		><slot name="label"></slot>
		<div
			class="positioning-region ${(x) => (x.orientation === Orientation.horizontal ? "horizontal" : "vertical")}"
			part="positioning-region">
			<slot
				${slotted({
					property: "slottedRadioButtons",
					filter: elements("[role=radio]"),
				})}></slot></div
	></template>`

/**
 * An Radio Group Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#radiogroup | ARIA radiogroup }.
 *
 * @slot label - The slot for the label
 * @slot - The default slot for radio buttons
 * @csspart positioning-region - The positioning region for laying out the radios
 * @fires change - Fires a custom 'change' event when the value changes
 *
 * @public
 */
class RadioGroup$1 extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * The orientation of the group
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: orientation
		 */
		this.orientation = Orientation.horizontal
		this.radioChangeHandler = (e) => {
			const changedRadio = e.target
			if (changedRadio.checked) {
				this.slottedRadioButtons.forEach((radio) => {
					if (radio !== changedRadio) {
						radio.checked = false
						if (!this.isInsideFoundationToolbar) {
							radio.setAttribute("tabindex", "-1")
						}
					}
				})
				this.selectedRadio = changedRadio
				this.value = changedRadio.value
				changedRadio.setAttribute("tabindex", "0")
				this.focusedRadio = changedRadio
			}
			e.stopPropagation()
		}
		this.moveToRadioByIndex = (group, index) => {
			const radio = group[index]
			if (!this.isInsideToolbar) {
				radio.setAttribute("tabindex", "0")
				if (radio.readOnly) {
					this.slottedRadioButtons.forEach((nextRadio) => {
						if (nextRadio !== radio) {
							nextRadio.setAttribute("tabindex", "-1")
						}
					})
				} else {
					radio.checked = true
					this.selectedRadio = radio
				}
			}
			this.focusedRadio = radio
			radio.focus()
		}
		this.moveRightOffGroup = () => {
			var _a
			;(_a = this.nextElementSibling) === null || _a === void 0 ? void 0 : _a.focus()
		}
		this.moveLeftOffGroup = () => {
			var _a
			;(_a = this.previousElementSibling) === null || _a === void 0 ? void 0 : _a.focus()
		}
		/**
		 * @internal
		 */
		this.focusOutHandler = (e) => {
			const group = this.slottedRadioButtons
			const radio = e.target
			const index = radio !== null ? group.indexOf(radio) : 0
			const focusedIndex = this.focusedRadio ? group.indexOf(this.focusedRadio) : -1
			if ((focusedIndex === 0 && index === focusedIndex) || (focusedIndex === group.length - 1 && focusedIndex === index)) {
				if (!this.selectedRadio) {
					this.focusedRadio = group[0]
					this.focusedRadio.setAttribute("tabindex", "0")
					group.forEach((nextRadio) => {
						if (nextRadio !== this.focusedRadio) {
							nextRadio.setAttribute("tabindex", "-1")
						}
					})
				} else {
					this.focusedRadio = this.selectedRadio
					if (!this.isInsideFoundationToolbar) {
						this.selectedRadio.setAttribute("tabindex", "0")
						group.forEach((nextRadio) => {
							if (nextRadio !== this.selectedRadio) {
								nextRadio.setAttribute("tabindex", "-1")
							}
						})
					}
				}
			}
			return true
		}
		/**
		 * @internal
		 */
		this.clickHandler = (e) => {
			const radio = e.target
			if (radio) {
				const group = this.slottedRadioButtons
				if (radio.checked || group.indexOf(radio) === 0) {
					radio.setAttribute("tabindex", "0")
					this.selectedRadio = radio
				} else {
					radio.setAttribute("tabindex", "-1")
					this.selectedRadio = null
				}
				this.focusedRadio = radio
			}
			e.preventDefault()
		}
		this.shouldMoveOffGroupToTheRight = (index, group, key) => {
			return index === group.length && this.isInsideToolbar && key === keyArrowRight
		}
		this.shouldMoveOffGroupToTheLeft = (group, key) => {
			const index = this.focusedRadio ? group.indexOf(this.focusedRadio) - 1 : 0
			return index < 0 && this.isInsideToolbar && key === keyArrowLeft
		}
		this.checkFocusedRadio = () => {
			if (this.focusedRadio !== null && !this.focusedRadio.readOnly && !this.focusedRadio.checked) {
				this.focusedRadio.checked = true
				this.focusedRadio.setAttribute("tabindex", "0")
				this.focusedRadio.focus()
				this.selectedRadio = this.focusedRadio
			}
		}
		this.moveRight = (e) => {
			const group = this.slottedRadioButtons
			let index = 0
			index = this.focusedRadio ? group.indexOf(this.focusedRadio) + 1 : 1
			if (this.shouldMoveOffGroupToTheRight(index, group, e.key)) {
				this.moveRightOffGroup()
				return
			} else if (index === group.length) {
				index = 0
			}
			/* looping to get to next radio that is not disabled */
			/* matching native radio/radiogroup which does not select an item if there is only 1 in the group */
			while (index < group.length && group.length > 1) {
				if (!group[index].disabled) {
					this.moveToRadioByIndex(group, index)
					break
				} else if (this.focusedRadio && index === group.indexOf(this.focusedRadio)) {
					break
				} else if (index + 1 >= group.length) {
					if (this.isInsideToolbar) {
						break
					} else {
						index = 0
					}
				} else {
					index += 1
				}
			}
		}
		this.moveLeft = (e) => {
			const group = this.slottedRadioButtons
			let index = 0
			index = this.focusedRadio ? group.indexOf(this.focusedRadio) - 1 : 0
			index = index < 0 ? group.length - 1 : index
			if (this.shouldMoveOffGroupToTheLeft(group, e.key)) {
				this.moveLeftOffGroup()
				return
			}
			/* looping to get to next radio that is not disabled */
			while (index >= 0 && group.length > 1) {
				if (!group[index].disabled) {
					this.moveToRadioByIndex(group, index)
					break
				} else if (this.focusedRadio && index === group.indexOf(this.focusedRadio)) {
					break
				} else if (index - 1 < 0) {
					index = group.length - 1
				} else {
					index -= 1
				}
			}
		}
		/**
		 * keyboard handling per https://w3c.github.io/aria-practices/#for-radio-groups-not-contained-in-a-toolbar
		 * navigation is different when there is an ancestor with role='toolbar'
		 *
		 * @internal
		 */
		this.keydownHandler = (e) => {
			const key = e.key
			if (key in ArrowKeys && this.isInsideFoundationToolbar) {
				return true
			}
			switch (key) {
				case keyEnter: {
					this.checkFocusedRadio()
					break
				}
				case keyArrowRight:
				case keyArrowDown: {
					if (this.direction === Direction.ltr) {
						this.moveRight(e)
					} else {
						this.moveLeft(e)
					}
					break
				}
				case keyArrowLeft:
				case keyArrowUp: {
					if (this.direction === Direction.ltr) {
						this.moveLeft(e)
					} else {
						this.moveRight(e)
					}
					break
				}
				default: {
					return true
				}
			}
		}
	}
	readOnlyChanged() {
		if (this.slottedRadioButtons !== undefined) {
			this.slottedRadioButtons.forEach((radio) => {
				if (this.readOnly) {
					radio.readOnly = true
				} else {
					radio.readOnly = false
				}
			})
		}
	}
	disabledChanged() {
		if (this.slottedRadioButtons !== undefined) {
			this.slottedRadioButtons.forEach((radio) => {
				if (this.disabled) {
					radio.disabled = true
				} else {
					radio.disabled = false
				}
			})
		}
	}
	nameChanged() {
		if (this.slottedRadioButtons) {
			this.slottedRadioButtons.forEach((radio) => {
				radio.setAttribute("name", this.name)
			})
		}
	}
	valueChanged() {
		if (this.slottedRadioButtons) {
			this.slottedRadioButtons.forEach((radio) => {
				if (radio.value === this.value) {
					radio.checked = true
					this.selectedRadio = radio
				}
			})
		}
		this.$emit("change")
	}
	slottedRadioButtonsChanged(oldValue, newValue) {
		if (this.slottedRadioButtons && this.slottedRadioButtons.length > 0) {
			this.setupRadioButtons()
		}
	}
	get parentToolbar() {
		return this.closest('[role="toolbar"]')
	}
	get isInsideToolbar() {
		var _a
		return (_a = this.parentToolbar) !== null && _a !== void 0 ? _a : false
	}
	get isInsideFoundationToolbar() {
		var _a
		return !!((_a = this.parentToolbar) === null || _a === void 0 ? void 0 : _a["$fastController"])
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		this.direction = getDirection(this)
		this.setupRadioButtons()
	}
	disconnectedCallback() {
		this.slottedRadioButtons.forEach((radio) => {
			radio.removeEventListener("change", this.radioChangeHandler)
		})
	}
	setupRadioButtons() {
		const checkedRadios = this.slottedRadioButtons.filter((radio) => {
			return radio.hasAttribute("checked")
		})
		const numberOfCheckedRadios = checkedRadios ? checkedRadios.length : 0
		if (numberOfCheckedRadios > 1) {
			const lastCheckedRadio = checkedRadios[numberOfCheckedRadios - 1]
			lastCheckedRadio.checked = true
		}
		let foundMatchingVal = false
		this.slottedRadioButtons.forEach((radio) => {
			if (this.name !== undefined) {
				radio.setAttribute("name", this.name)
			}
			if (this.disabled) {
				radio.disabled = true
			}
			if (this.readOnly) {
				radio.readOnly = true
			}
			if (this.value && this.value === radio.value) {
				this.selectedRadio = radio
				this.focusedRadio = radio
				radio.checked = true
				radio.setAttribute("tabindex", "0")
				foundMatchingVal = true
			} else {
				if (!this.isInsideFoundationToolbar) {
					radio.setAttribute("tabindex", "-1")
				}
				radio.checked = false
			}
			radio.addEventListener("change", this.radioChangeHandler)
		})
		if (this.value === undefined && this.slottedRadioButtons.length > 0) {
			const checkedRadios = this.slottedRadioButtons.filter((radio) => {
				return radio.hasAttribute("checked")
			})
			const numberOfCheckedRadios = checkedRadios !== null ? checkedRadios.length : 0
			if (numberOfCheckedRadios > 0 && !foundMatchingVal) {
				const lastCheckedRadio = checkedRadios[numberOfCheckedRadios - 1]
				lastCheckedRadio.checked = true
				this.focusedRadio = lastCheckedRadio
				lastCheckedRadio.setAttribute("tabindex", "0")
			} else {
				this.slottedRadioButtons[0].setAttribute("tabindex", "0")
				this.focusedRadio = this.slottedRadioButtons[0]
			}
		}
	}
}
__decorate$1(
	[
		attr({
			attribute: "readonly",
			mode: "boolean",
		}),
	],
	RadioGroup$1.prototype,
	"readOnly",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "disabled",
			mode: "boolean",
		}),
	],
	RadioGroup$1.prototype,
	"disabled",
	void 0,
)
__decorate$1([attr], RadioGroup$1.prototype, "name", void 0)
__decorate$1([attr], RadioGroup$1.prototype, "value", void 0)
__decorate$1([attr], RadioGroup$1.prototype, "orientation", void 0)
__decorate$1([observable], RadioGroup$1.prototype, "childItems", void 0)
__decorate$1([observable], RadioGroup$1.prototype, "slottedRadioButtons", void 0)

/**
 * The template for the {@link @microsoft/fast-foundation#(Radio:class)} component.
 * @public
 */
const radioTemplate = (context, definition) =>
	html`<template
		role="radio"
		class="${(x) => (x.checked ? "checked" : "")} ${(x) => (x.readOnly ? "readonly" : "")}"
		aria-checked="${(x) => x.checked}"
		aria-required="${(x) => x.required}"
		aria-disabled="${(x) => x.disabled}"
		aria-readonly="${(x) => x.readOnly}"
		@keypress="${(x, c) => x.keypressHandler(c.event)}"
		@click="${(x, c) => x.clickHandler(c.event)}"
		><div part="control" class="control"><slot name="checked-indicator">${definition.checkedIndicator || ""}</slot></div>
		<label
			part="label"
			class="${(x) => (x.defaultSlottedNodes && x.defaultSlottedNodes.length ? "label" : "label label__hidden")}"
			><slot ${slotted("defaultSlottedNodes")}></slot></label
	></template>`

class _Radio extends FoundationElement {}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Radio:class)} component.
 *
 * @internal
 */
class FormAssociatedRadio extends CheckableFormAssociated(_Radio) {
	constructor() {
		super(...arguments)
		this.proxy = document.createElement("input")
	}
}

/**
 * A Radio Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#radio | ARIA radio }.
 *
 * @slot checked-indicator - The checked indicator
 * @slot - The default slot for the label
 * @csspart control - The element representing the visual radio control
 * @csspart label - The label
 * @fires change - Emits a custom change event when the checked state changes
 *
 * @public
 */
class Radio$1 extends FormAssociatedRadio {
	constructor() {
		super()
		/**
		 * The element's value to be included in form submission when checked.
		 * Default to "on" to reach parity with input[type="radio"]
		 *
		 * @internal
		 */
		this.initialValue = "on"
		/**
		 * @internal
		 */
		this.keypressHandler = (e) => {
			switch (e.key) {
				case keySpace:
					if (!this.checked && !this.readOnly) {
						this.checked = true
					}
					return
			}
			return true
		}
		this.proxy.setAttribute("type", "radio")
	}
	readOnlyChanged() {
		if (this.proxy instanceof HTMLInputElement) {
			this.proxy.readOnly = this.readOnly
		}
	}
	/**
	 * @internal
	 */
	defaultCheckedChanged() {
		var _a
		if (this.$fastController.isConnected && !this.dirtyChecked) {
			// Setting this.checked will cause us to enter a dirty state,
			// but if we are clean when defaultChecked is changed, we want to stay
			// in a clean state, so reset this.dirtyChecked
			if (!this.isInsideRadioGroup()) {
				this.checked = (_a = this.defaultChecked) !== null && _a !== void 0 ? _a : false
				this.dirtyChecked = false
			}
		}
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		var _a, _b
		super.connectedCallback()
		this.validate()
		if (
			((_a = this.parentElement) === null || _a === void 0 ? void 0 : _a.getAttribute("role")) !== "radiogroup" &&
			this.getAttribute("tabindex") === null
		) {
			if (!this.disabled) {
				this.setAttribute("tabindex", "0")
			}
		}
		if (this.checkedAttribute) {
			if (!this.dirtyChecked) {
				// Setting this.checked will cause us to enter a dirty state,
				// but if we are clean when defaultChecked is changed, we want to stay
				// in a clean state, so reset this.dirtyChecked
				if (!this.isInsideRadioGroup()) {
					this.checked = (_b = this.defaultChecked) !== null && _b !== void 0 ? _b : false
					this.dirtyChecked = false
				}
			}
		}
	}
	isInsideRadioGroup() {
		const parent = this.closest("[role=radiogroup]")
		return parent !== null
	}
	/**
	 * @internal
	 */
	clickHandler(e) {
		if (!this.disabled && !this.readOnly && !this.checked) {
			this.checked = true
		}
	}
}
__decorate$1(
	[
		attr({
			attribute: "readonly",
			mode: "boolean",
		}),
	],
	Radio$1.prototype,
	"readOnly",
	void 0,
)
__decorate$1([observable], Radio$1.prototype, "name", void 0)
__decorate$1([observable], Radio$1.prototype, "defaultSlottedNodes", void 0)

/**
 * a method to filter out any whitespace _only_ nodes, to be used inside a template
 * @param value - The Node that is being inspected
 * @param index - The index of the node within the array
 * @param array - The Node array that is being filtered
 *
 * @public
 */
function whitespaceFilter(value, index, array) {
	return value.nodeType !== Node.TEXT_NODE ? true : typeof value.nodeValue === "string" && !!value.nodeValue.trim().length
}

class _Select extends ListboxElement {}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Select:class)} component.
 *
 * @internal
 */
class FormAssociatedSelect extends FormAssociated(_Select) {
	constructor() {
		super(...arguments)
		this.proxy = document.createElement("select")
	}
}

/**
 * A Select Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#select | ARIA select }.
 *
 * @slot start - Content which can be provided before the button content
 * @slot end - Content which can be provided after the button content
 * @slot button-container - The element representing the select button
 * @slot selected-value - The selected value
 * @slot indicator - The visual indicator for the expand/collapse state of the button
 * @slot - The default slot for slotted options
 * @csspart control - The element representing the select invoking element
 * @csspart selected-value - The element wrapping the selected value
 * @csspart indicator - The element wrapping the visual indicator
 * @csspart listbox - The listbox element
 * @fires input - Fires a custom 'input' event when the value updates
 * @fires change - Fires a custom 'change' event when the value updates
 *
 * @public
 */
class Select extends FormAssociatedSelect {
	constructor() {
		super(...arguments)
		/**
		 * The open attribute.
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: open
		 */
		this.open = false
		/**
		 * Indicates the initial state of the position attribute.
		 *
		 * @internal
		 */
		this.forcedPosition = false
		/**
		 * The unique id for the internal listbox element.
		 *
		 * @internal
		 */
		this.listboxId = uniqueId("listbox-")
		/**
		 * The max height for the listbox when opened.
		 *
		 * @internal
		 */
		this.maxHeight = 0
	}
	/**
	 * Sets focus and synchronizes ARIA attributes when the open property changes.
	 *
	 * @param prev - the previous open value
	 * @param next - the current open value
	 *
	 * @internal
	 */
	openChanged(prev, next) {
		if (!this.collapsible) {
			return
		}
		if (this.open) {
			this.ariaControls = this.listboxId
			this.ariaExpanded = "true"
			this.setPositioning()
			this.focusAndScrollOptionIntoView()
			this.indexWhenOpened = this.selectedIndex
			// focus is directed to the element when `open` is changed programmatically
			DOM.queueUpdate(() => this.focus())
			return
		}
		this.ariaControls = ""
		this.ariaExpanded = "false"
	}
	/**
	 * The component is collapsible when in single-selection mode with no size attribute.
	 *
	 * @internal
	 */
	get collapsible() {
		return !(this.multiple || typeof this.size === "number")
	}
	/**
	 * The value property.
	 *
	 * @public
	 */
	get value() {
		Observable.track(this, "value")
		return this._value
	}
	set value(next) {
		var _a, _b, _c, _d, _e, _f, _g
		const prev = `${this._value}`
		if ((_a = this._options) === null || _a === void 0 ? void 0 : _a.length) {
			const selectedIndex = this._options.findIndex((el) => el.value === next)
			const prevSelectedValue =
				(_c = (_b = this._options[this.selectedIndex]) === null || _b === void 0 ? void 0 : _b.value) !== null &&
				_c !== void 0
					? _c
					: null
			const nextSelectedValue =
				(_e = (_d = this._options[selectedIndex]) === null || _d === void 0 ? void 0 : _d.value) !== null && _e !== void 0
					? _e
					: null
			if (selectedIndex === -1 || prevSelectedValue !== nextSelectedValue) {
				next = ""
				this.selectedIndex = selectedIndex
			}
			next =
				(_g = (_f = this.firstSelectedOption) === null || _f === void 0 ? void 0 : _f.value) !== null && _g !== void 0
					? _g
					: next
		}
		if (prev !== next) {
			this._value = next
			super.valueChanged(prev, next)
			Observable.notify(this, "value")
			this.updateDisplayValue()
		}
	}
	/**
	 * Sets the value and display value to match the first selected option.
	 *
	 * @param shouldEmit - if true, the input and change events will be emitted
	 *
	 * @internal
	 */
	updateValue(shouldEmit) {
		var _a, _b
		if (this.$fastController.isConnected) {
			this.value =
				(_b = (_a = this.firstSelectedOption) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0
					? _b
					: ""
		}
		if (shouldEmit) {
			this.$emit("input")
			this.$emit("change", this, {
				bubbles: true,
				composed: undefined,
			})
		}
	}
	/**
	 * Updates the proxy value when the selected index changes.
	 *
	 * @param prev - the previous selected index
	 * @param next - the next selected index
	 *
	 * @internal
	 */
	selectedIndexChanged(prev, next) {
		super.selectedIndexChanged(prev, next)
		this.updateValue()
	}
	positionChanged(prev, next) {
		this.positionAttribute = next
		this.setPositioning()
	}
	/**
	 * Calculate and apply listbox positioning based on available viewport space.
	 *
	 * @public
	 */
	setPositioning() {
		const currentBox = this.getBoundingClientRect()
		const viewportHeight = window.innerHeight
		const availableBottom = viewportHeight - currentBox.bottom
		this.position = this.forcedPosition
			? this.positionAttribute
			: currentBox.top > availableBottom
				? SelectPosition.above
				: SelectPosition.below
		this.positionAttribute = this.forcedPosition ? this.positionAttribute : this.position
		this.maxHeight = this.position === SelectPosition.above ? ~~currentBox.top : ~~availableBottom
	}
	/**
	 * The value displayed on the button.
	 *
	 * @public
	 */
	get displayValue() {
		var _a, _b
		Observable.track(this, "displayValue")
		return (_b = (_a = this.firstSelectedOption) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0
			? _b
			: ""
	}
	/**
	 * Synchronize the `aria-disabled` property when the `disabled` property changes.
	 *
	 * @param prev - The previous disabled value
	 * @param next - The next disabled value
	 *
	 * @internal
	 */
	disabledChanged(prev, next) {
		if (super.disabledChanged) {
			super.disabledChanged(prev, next)
		}
		this.ariaDisabled = this.disabled ? "true" : "false"
	}
	/**
	 * Reset the element to its first selectable option when its parent form is reset.
	 *
	 * @internal
	 */
	formResetCallback() {
		this.setProxyOptions()
		// Call the base class's implementation setDefaultSelectedOption instead of the select's
		// override, in order to reset the selectedIndex without using the value property.
		super.setDefaultSelectedOption()
		if (this.selectedIndex === -1) {
			this.selectedIndex = 0
		}
	}
	/**
	 * Handle opening and closing the listbox when the select is clicked.
	 *
	 * @param e - the mouse event
	 * @internal
	 */
	clickHandler(e) {
		// do nothing if the select is disabled
		if (this.disabled) {
			return
		}
		if (this.open) {
			const captured = e.target.closest(`option,[role=option]`)
			if (captured && captured.disabled) {
				return
			}
		}
		super.clickHandler(e)
		this.open = this.collapsible && !this.open
		if (!this.open && this.indexWhenOpened !== this.selectedIndex) {
			this.updateValue(true)
		}
		return true
	}
	/**
	 * Handles focus state when the element or its children lose focus.
	 *
	 * @param e - The focus event
	 * @internal
	 */
	focusoutHandler(e) {
		var _a
		super.focusoutHandler(e)
		if (!this.open) {
			return true
		}
		const focusTarget = e.relatedTarget
		if (this.isSameNode(focusTarget)) {
			this.focus()
			return
		}
		if (!((_a = this.options) === null || _a === void 0 ? void 0 : _a.includes(focusTarget))) {
			this.open = false
			if (this.indexWhenOpened !== this.selectedIndex) {
				this.updateValue(true)
			}
		}
	}
	/**
	 * Updates the value when an option's value changes.
	 *
	 * @param source - the source object
	 * @param propertyName - the property to evaluate
	 *
	 * @internal
	 * @override
	 */
	handleChange(source, propertyName) {
		super.handleChange(source, propertyName)
		if (propertyName === "value") {
			this.updateValue()
		}
	}
	/**
	 * Synchronize the form-associated proxy and updates the value property of the element.
	 *
	 * @param prev - the previous collection of slotted option elements
	 * @param next - the next collection of slotted option elements
	 *
	 * @internal
	 */
	slottedOptionsChanged(prev, next) {
		this.options.forEach((o) => {
			const notifier = Observable.getNotifier(o)
			notifier.unsubscribe(this, "value")
		})
		super.slottedOptionsChanged(prev, next)
		this.options.forEach((o) => {
			const notifier = Observable.getNotifier(o)
			notifier.subscribe(this, "value")
		})
		this.setProxyOptions()
		this.updateValue()
	}
	/**
	 * Prevents focus when size is set and a scrollbar is clicked.
	 *
	 * @param e - the mouse event object
	 *
	 * @override
	 * @internal
	 */
	mousedownHandler(e) {
		var _a
		if (e.offsetX >= 0 && e.offsetX <= ((_a = this.listbox) === null || _a === void 0 ? void 0 : _a.scrollWidth)) {
			return super.mousedownHandler(e)
		}
		return this.collapsible
	}
	/**
	 * Sets the multiple property on the proxy element.
	 *
	 * @param prev - the previous multiple value
	 * @param next - the current multiple value
	 */
	multipleChanged(prev, next) {
		super.multipleChanged(prev, next)
		if (this.proxy) {
			this.proxy.multiple = next
		}
	}
	/**
	 * Updates the selectedness of each option when the list of selected options changes.
	 *
	 * @param prev - the previous list of selected options
	 * @param next - the current list of selected options
	 *
	 * @override
	 * @internal
	 */
	selectedOptionsChanged(prev, next) {
		var _a
		super.selectedOptionsChanged(prev, next)
		;(_a = this.options) === null || _a === void 0
			? void 0
			: _a.forEach((o, i) => {
					var _a
					const proxyOption = (_a = this.proxy) === null || _a === void 0 ? void 0 : _a.options.item(i)
					if (proxyOption) {
						proxyOption.selected = o.selected
					}
				})
	}
	/**
	 * Sets the selected index to match the first option with the selected attribute, or
	 * the first selectable option.
	 *
	 * @override
	 * @internal
	 */
	setDefaultSelectedOption() {
		var _a
		const options =
			(_a = this.options) !== null && _a !== void 0 ? _a : Array.from(this.children).filter(Listbox.slottedOptionFilter)
		const selectedIndex =
			options === null || options === void 0
				? void 0
				: options.findIndex((el) => el.hasAttribute("selected") || el.selected || el.value === this.value)
		if (selectedIndex !== -1) {
			this.selectedIndex = selectedIndex
			return
		}
		this.selectedIndex = 0
	}
	/**
	 * Resets and fills the proxy to match the component's options.
	 *
	 * @internal
	 */
	setProxyOptions() {
		if (this.proxy instanceof HTMLSelectElement && this.options) {
			this.proxy.options.length = 0
			this.options.forEach((option) => {
				const proxyOption = option.proxy || (option instanceof HTMLOptionElement ? option.cloneNode() : null)
				if (proxyOption) {
					this.proxy.options.add(proxyOption)
				}
			})
		}
	}
	/**
	 * Handle keyboard interaction for the select.
	 *
	 * @param e - the keyboard event
	 * @internal
	 */
	keydownHandler(e) {
		super.keydownHandler(e)
		const key = e.key || e.key.charCodeAt(0)
		switch (key) {
			case keySpace: {
				e.preventDefault()
				if (this.collapsible && this.typeAheadExpired) {
					this.open = !this.open
				}
				break
			}
			case keyHome:
			case keyEnd: {
				e.preventDefault()
				break
			}
			case keyEnter: {
				e.preventDefault()
				this.open = !this.open
				break
			}
			case keyEscape: {
				if (this.collapsible && this.open) {
					e.preventDefault()
					this.open = false
				}
				break
			}
			case keyTab: {
				if (this.collapsible && this.open) {
					e.preventDefault()
					this.open = false
				}
				return true
			}
		}
		if (!this.open && this.indexWhenOpened !== this.selectedIndex) {
			this.updateValue(true)
			this.indexWhenOpened = this.selectedIndex
		}
		return !(key === keyArrowDown || key === keyArrowUp)
	}
	connectedCallback() {
		super.connectedCallback()
		this.forcedPosition = !!this.positionAttribute
		this.addEventListener("contentchange", this.updateDisplayValue)
	}
	disconnectedCallback() {
		this.removeEventListener("contentchange", this.updateDisplayValue)
		super.disconnectedCallback()
	}
	/**
	 * Updates the proxy's size property when the size attribute changes.
	 *
	 * @param prev - the previous size
	 * @param next - the current size
	 *
	 * @override
	 * @internal
	 */
	sizeChanged(prev, next) {
		super.sizeChanged(prev, next)
		if (this.proxy) {
			this.proxy.size = next
		}
	}
	/**
	 *
	 * @internal
	 */
	updateDisplayValue() {
		if (this.collapsible) {
			Observable.notify(this, "displayValue")
		}
	}
}
__decorate$1(
	[
		attr({
			attribute: "open",
			mode: "boolean",
		}),
	],
	Select.prototype,
	"open",
	void 0,
)
__decorate$1([volatile], Select.prototype, "collapsible", null)
__decorate$1([observable], Select.prototype, "control", void 0)
__decorate$1(
	[
		attr({
			attribute: "position",
		}),
	],
	Select.prototype,
	"positionAttribute",
	void 0,
)
__decorate$1([observable], Select.prototype, "position", void 0)
__decorate$1([observable], Select.prototype, "maxHeight", void 0)
/**
 * Includes ARIA states and properties relating to the ARIA select role.
 *
 * @public
 */
class DelegatesARIASelect {}
__decorate$1([observable], DelegatesARIASelect.prototype, "ariaControls", void 0)
applyMixins(DelegatesARIASelect, DelegatesARIAListbox)
applyMixins(Select, StartEnd, DelegatesARIASelect)

/**
 * The template for the {@link @microsoft/fast-foundation#(Select:class)} component.
 * @public
 */
const selectTemplate = (context, definition) =>
	html`<template
		class="${(x) =>
			[
				x.collapsible && "collapsible",
				x.collapsible && x.open && "open",
				x.disabled && "disabled",
				x.collapsible && x.position,
			]
				.filter(Boolean)
				.join(" ")}"
		aria-activedescendant="${(x) => x.ariaActiveDescendant}"
		aria-controls="${(x) => x.ariaControls}"
		aria-disabled="${(x) => x.ariaDisabled}"
		aria-expanded="${(x) => x.ariaExpanded}"
		aria-haspopup="${(x) => (x.collapsible ? "listbox" : null)}"
		aria-multiselectable="${(x) => x.ariaMultiSelectable}"
		?open="${(x) => x.open}"
		role="combobox"
		tabindex="${(x) => (!x.disabled ? "0" : null)}"
		@click="${(x, c) => x.clickHandler(c.event)}"
		@focusin="${(x, c) => x.focusinHandler(c.event)}"
		@focusout="${(x, c) => x.focusoutHandler(c.event)}"
		@keydown="${(x, c) => x.keydownHandler(c.event)}"
		@mousedown="${(x, c) => x.mousedownHandler(c.event)}"
		>${when(
			(x) => x.collapsible,
			html`<div class="control" part="control" ?disabled="${(x) => x.disabled}" ${ref("control")}>
				${startSlotTemplate(context, definition)}<slot name="button-container"
					><div class="selected-value" part="selected-value">
						<slot name="selected-value">${(x) => x.displayValue}</slot>
					</div>
					<div aria-hidden="true" class="indicator" part="indicator">
						<slot name="indicator">${definition.indicator || ""}</slot>
					</div></slot
				>${endSlotTemplate(context, definition)}
			</div>`,
		)}
		<div
			class="listbox"
			id="${(x) => x.listboxId}"
			part="listbox"
			role="listbox"
			?disabled="${(x) => x.disabled}"
			?hidden="${(x) => (x.collapsible ? !x.open : false)}"
			${ref("listbox")}>
			<slot
				${slotted({
					filter: Listbox.slottedOptionFilter,
					flatten: true,
					property: "slottedOptions",
				})}></slot></div
	></template>`

/**
 * The template for the {@link @microsoft/fast-foundation#TabPanel} component.
 * @public
 */
const tabPanelTemplate = (context, definition) => html`<template slot="tabpanel" role="tabpanel"><slot></slot></template>`

/**
 * A TabPanel Component to be used with {@link @microsoft/fast-foundation#(Tabs:class)}
 *
 * @slot - The default slot for the tabpanel content
 *
 * @public
 */
class TabPanel extends FoundationElement {}

/**
 * The template for the {@link @microsoft/fast-foundation#Tab} component.
 * @public
 */
const tabTemplate = (context, definition) =>
	html`<template slot="tab" role="tab" aria-disabled="${(x) => x.disabled}"><slot></slot></template>`

/**
 * A Tab Component to be used with {@link @microsoft/fast-foundation#(Tabs:class)}
 *
 * @slot - The default slot for the tab content
 *
 * @public
 */
class Tab extends FoundationElement {}
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	Tab.prototype,
	"disabled",
	void 0,
)

/**
 * The template for the {@link @microsoft/fast-foundation#(Tabs:class)} component.
 * @public
 */
const tabsTemplate = (context, definition) =>
	html`<template class="${(x) => x.orientation}"
		>${startSlotTemplate(context, definition)}
		<div class="tablist" part="tablist" role="tablist">
			<slot class="tab" name="tab" part="tab" ${slotted("tabs")}></slot>${when(
				(x) => x.showActiveIndicator,
				html`<div ${ref("activeIndicatorRef")} class="activeIndicator" part="activeIndicator"></div>`,
			)}
		</div>
		${endSlotTemplate(context, definition)}
		<div class="tabpanel" part="tabpanel"><slot name="tabpanel" ${slotted("tabpanels")}></slot></div
	></template>`

/**
 * The orientation of the {@link @microsoft/fast-foundation#(Tabs:class)} component
 * @public
 */
const TabsOrientation = {
	vertical: "vertical",
	horizontal: "horizontal",
}
/**
 * A Tabs Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#tablist | ARIA tablist }.
 *
 * @slot start - Content which can be provided before the tablist element
 * @slot end - Content which can be provided after the tablist element
 * @slot tab - The slot for tabs
 * @slot tabpanel - The slot for tabpanels
 * @csspart tablist - The element wrapping for the tabs
 * @csspart tab - The tab slot
 * @csspart activeIndicator - The visual indicator
 * @csspart tabpanel - The tabpanel slot
 * @fires change - Fires a custom 'change' event when a tab is clicked or during keyboard navigation
 *
 * @public
 */
class Tabs extends FoundationElement {
	constructor() {
		super(...arguments)
		/**
		 * The orientation
		 * @public
		 * @remarks
		 * HTML Attribute: orientation
		 */
		this.orientation = TabsOrientation.horizontal
		/**
		 * Whether or not to show the active indicator
		 * @public
		 * @remarks
		 * HTML Attribute: activeindicator
		 */
		this.activeindicator = true
		/**
		 * @internal
		 */
		this.showActiveIndicator = true
		this.prevActiveTabIndex = 0
		this.activeTabIndex = 0
		this.ticking = false
		this.change = () => {
			this.$emit("change", this.activetab)
		}
		this.isDisabledElement = (el) => {
			return el.getAttribute("aria-disabled") === "true"
		}
		this.isHiddenElement = (el) => {
			return el.hasAttribute("hidden")
		}
		this.isFocusableElement = (el) => {
			return !this.isDisabledElement(el) && !this.isHiddenElement(el)
		}
		this.setTabs = () => {
			const gridHorizontalProperty = "gridColumn"
			const gridVerticalProperty = "gridRow"
			const gridProperty = this.isHorizontal() ? gridHorizontalProperty : gridVerticalProperty
			this.activeTabIndex = this.getActiveIndex()
			this.showActiveIndicator = false
			this.tabs.forEach((tab, index) => {
				if (tab.slot === "tab") {
					const isActiveTab = this.activeTabIndex === index && this.isFocusableElement(tab)
					if (this.activeindicator && this.isFocusableElement(tab)) {
						this.showActiveIndicator = true
					}
					const tabId = this.tabIds[index]
					const tabpanelId = this.tabpanelIds[index]
					tab.setAttribute("id", tabId)
					tab.setAttribute("aria-selected", isActiveTab ? "true" : "false")
					tab.setAttribute("aria-controls", tabpanelId)
					tab.addEventListener("click", this.handleTabClick)
					tab.addEventListener("keydown", this.handleTabKeyDown)
					tab.setAttribute("tabindex", isActiveTab ? "0" : "-1")
					if (isActiveTab) {
						this.activetab = tab
						this.activeid = tabId
					}
				}
				// If the original property isn't emptied out,
				// the next set will morph into a grid-area style setting that is not what we want
				tab.style[gridHorizontalProperty] = ""
				tab.style[gridVerticalProperty] = ""
				tab.style[gridProperty] = `${index + 1}`
				!this.isHorizontal() ? tab.classList.add("vertical") : tab.classList.remove("vertical")
			})
		}
		this.setTabPanels = () => {
			this.tabpanels.forEach((tabpanel, index) => {
				const tabId = this.tabIds[index]
				const tabpanelId = this.tabpanelIds[index]
				tabpanel.setAttribute("id", tabpanelId)
				tabpanel.setAttribute("aria-labelledby", tabId)
				this.activeTabIndex !== index ? tabpanel.setAttribute("hidden", "") : tabpanel.removeAttribute("hidden")
			})
		}
		this.handleTabClick = (event) => {
			const selectedTab = event.currentTarget
			if (selectedTab.nodeType === 1 && this.isFocusableElement(selectedTab)) {
				this.prevActiveTabIndex = this.activeTabIndex
				this.activeTabIndex = this.tabs.indexOf(selectedTab)
				this.setComponent()
			}
		}
		this.handleTabKeyDown = (event) => {
			if (this.isHorizontal()) {
				switch (event.key) {
					case keyArrowLeft:
						event.preventDefault()
						this.adjustBackward(event)
						break
					case keyArrowRight:
						event.preventDefault()
						this.adjustForward(event)
						break
				}
			} else {
				switch (event.key) {
					case keyArrowUp:
						event.preventDefault()
						this.adjustBackward(event)
						break
					case keyArrowDown:
						event.preventDefault()
						this.adjustForward(event)
						break
				}
			}
			switch (event.key) {
				case keyHome:
					event.preventDefault()
					this.adjust(-this.activeTabIndex)
					break
				case keyEnd:
					event.preventDefault()
					this.adjust(this.tabs.length - this.activeTabIndex - 1)
					break
			}
		}
		this.adjustForward = (e) => {
			const group = this.tabs
			let index = 0
			index = this.activetab ? group.indexOf(this.activetab) + 1 : 1
			if (index === group.length) {
				index = 0
			}
			while (index < group.length && group.length > 1) {
				if (this.isFocusableElement(group[index])) {
					this.moveToTabByIndex(group, index)
					break
				} else if (this.activetab && index === group.indexOf(this.activetab)) {
					break
				} else if (index + 1 >= group.length) {
					index = 0
				} else {
					index += 1
				}
			}
		}
		this.adjustBackward = (e) => {
			const group = this.tabs
			let index = 0
			index = this.activetab ? group.indexOf(this.activetab) - 1 : 0
			index = index < 0 ? group.length - 1 : index
			while (index >= 0 && group.length > 1) {
				if (this.isFocusableElement(group[index])) {
					this.moveToTabByIndex(group, index)
					break
				} else if (index - 1 < 0) {
					index = group.length - 1
				} else {
					index -= 1
				}
			}
		}
		this.moveToTabByIndex = (group, index) => {
			const tab = group[index]
			this.activetab = tab
			this.prevActiveTabIndex = this.activeTabIndex
			this.activeTabIndex = index
			tab.focus()
			this.setComponent()
		}
	}
	/**
	 * @internal
	 */
	orientationChanged() {
		if (this.$fastController.isConnected) {
			this.setTabs()
			this.setTabPanels()
			this.handleActiveIndicatorPosition()
		}
	}
	/**
	 * @internal
	 */
	activeidChanged(oldValue, newValue) {
		if (this.$fastController.isConnected && this.tabs.length <= this.tabpanels.length) {
			this.prevActiveTabIndex = this.tabs.findIndex((item) => item.id === oldValue)
			this.setTabs()
			this.setTabPanels()
			this.handleActiveIndicatorPosition()
		}
	}
	/**
	 * @internal
	 */
	tabsChanged() {
		if (this.$fastController.isConnected && this.tabs.length <= this.tabpanels.length) {
			this.tabIds = this.getTabIds()
			this.tabpanelIds = this.getTabPanelIds()
			this.setTabs()
			this.setTabPanels()
			this.handleActiveIndicatorPosition()
		}
	}
	/**
	 * @internal
	 */
	tabpanelsChanged() {
		if (this.$fastController.isConnected && this.tabpanels.length <= this.tabs.length) {
			this.tabIds = this.getTabIds()
			this.tabpanelIds = this.getTabPanelIds()
			this.setTabs()
			this.setTabPanels()
			this.handleActiveIndicatorPosition()
		}
	}
	getActiveIndex() {
		const id = this.activeid
		if (id !== undefined) {
			return this.tabIds.indexOf(this.activeid) === -1 ? 0 : this.tabIds.indexOf(this.activeid)
		} else {
			return 0
		}
	}
	getTabIds() {
		return this.tabs.map((tab) => {
			var _a
			return (_a = tab.getAttribute("id")) !== null && _a !== void 0 ? _a : `tab-${uniqueId()}`
		})
	}
	getTabPanelIds() {
		return this.tabpanels.map((tabPanel) => {
			var _a
			return (_a = tabPanel.getAttribute("id")) !== null && _a !== void 0 ? _a : `panel-${uniqueId()}`
		})
	}
	setComponent() {
		if (this.activeTabIndex !== this.prevActiveTabIndex) {
			this.activeid = this.tabIds[this.activeTabIndex]
			this.focusTab()
			this.change()
		}
	}
	isHorizontal() {
		return this.orientation === TabsOrientation.horizontal
	}
	handleActiveIndicatorPosition() {
		// Ignore if we click twice on the same tab
		if (this.showActiveIndicator && this.activeindicator && this.activeTabIndex !== this.prevActiveTabIndex) {
			if (this.ticking) {
				this.ticking = false
			} else {
				this.ticking = true
				this.animateActiveIndicator()
			}
		}
	}
	animateActiveIndicator() {
		this.ticking = true
		const gridProperty = this.isHorizontal() ? "gridColumn" : "gridRow"
		const translateProperty = this.isHorizontal() ? "translateX" : "translateY"
		const offsetProperty = this.isHorizontal() ? "offsetLeft" : "offsetTop"
		const prev = this.activeIndicatorRef[offsetProperty]
		this.activeIndicatorRef.style[gridProperty] = `${this.activeTabIndex + 1}`
		const next = this.activeIndicatorRef[offsetProperty]
		this.activeIndicatorRef.style[gridProperty] = `${this.prevActiveTabIndex + 1}`
		const dif = next - prev
		this.activeIndicatorRef.style.transform = `${translateProperty}(${dif}px)`
		this.activeIndicatorRef.classList.add("activeIndicatorTransition")
		this.activeIndicatorRef.addEventListener("transitionend", () => {
			this.ticking = false
			this.activeIndicatorRef.style[gridProperty] = `${this.activeTabIndex + 1}`
			this.activeIndicatorRef.style.transform = `${translateProperty}(0px)`
			this.activeIndicatorRef.classList.remove("activeIndicatorTransition")
		})
	}
	/**
	 * The adjust method for FASTTabs
	 * @public
	 * @remarks
	 * This method allows the active index to be adjusted by numerical increments
	 */
	adjust(adjustment) {
		const focusableTabs = this.tabs.filter((t) => this.isFocusableElement(t))
		const currentActiveTabIndex = focusableTabs.indexOf(this.activetab)
		const nextTabIndex = limit(0, focusableTabs.length - 1, currentActiveTabIndex + adjustment)
		// the index of the next focusable tab within the context of all available tabs
		const nextIndex = this.tabs.indexOf(focusableTabs[nextTabIndex])
		if (nextIndex > -1) {
			this.moveToTabByIndex(this.tabs, nextIndex)
		}
	}
	focusTab() {
		this.tabs[this.activeTabIndex].focus()
	}
	/**
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		this.tabIds = this.getTabIds()
		this.tabpanelIds = this.getTabPanelIds()
		this.activeTabIndex = this.getActiveIndex()
	}
}
__decorate$1([attr], Tabs.prototype, "orientation", void 0)
__decorate$1([attr], Tabs.prototype, "activeid", void 0)
__decorate$1([observable], Tabs.prototype, "tabs", void 0)
__decorate$1([observable], Tabs.prototype, "tabpanels", void 0)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	Tabs.prototype,
	"activeindicator",
	void 0,
)
__decorate$1([observable], Tabs.prototype, "activeIndicatorRef", void 0)
__decorate$1([observable], Tabs.prototype, "showActiveIndicator", void 0)
applyMixins(Tabs, StartEnd)

class _TextArea extends FoundationElement {}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(TextArea:class)} component.
 *
 * @internal
 */
class FormAssociatedTextArea extends FormAssociated(_TextArea) {
	constructor() {
		super(...arguments)
		this.proxy = document.createElement("textarea")
	}
}

/**
 * Resize mode for a TextArea
 * @public
 */
const TextAreaResize = {
	/**
	 * No resize.
	 */
	none: "none",
	/**
	 * Resize vertically and horizontally.
	 */
	both: "both",
	/**
	 * Resize horizontally.
	 */
	horizontal: "horizontal",
	/**
	 * Resize vertically.
	 */
	vertical: "vertical",
}

/**
 * A Text Area Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/textarea | <textarea> element }.
 *
 * @slot - The default slot for the label
 * @csspart label - The label
 * @csspart root - The element wrapping the control
 * @csspart control - The textarea element
 * @fires change - Emits a custom 'change' event when the textarea emits a change event
 *
 * @public
 */
class TextArea$1 extends FormAssociatedTextArea {
	constructor() {
		super(...arguments)
		/**
		 * The resize mode of the element.
		 * @public
		 * @remarks
		 * HTML Attribute: resize
		 */
		this.resize = TextAreaResize.none
		/**
		 * Sizes the element horizontally by a number of character columns.
		 *
		 * @public
		 * @remarks
		 * HTML Attribute: cols
		 */
		this.cols = 20
		/**
		 * @internal
		 */
		this.handleTextInput = () => {
			this.value = this.control.value
		}
	}
	readOnlyChanged() {
		if (this.proxy instanceof HTMLTextAreaElement) {
			this.proxy.readOnly = this.readOnly
		}
	}
	autofocusChanged() {
		if (this.proxy instanceof HTMLTextAreaElement) {
			this.proxy.autofocus = this.autofocus
		}
	}
	listChanged() {
		if (this.proxy instanceof HTMLTextAreaElement) {
			this.proxy.setAttribute("list", this.list)
		}
	}
	maxlengthChanged() {
		if (this.proxy instanceof HTMLTextAreaElement) {
			this.proxy.maxLength = this.maxlength
		}
	}
	minlengthChanged() {
		if (this.proxy instanceof HTMLTextAreaElement) {
			this.proxy.minLength = this.minlength
		}
	}
	spellcheckChanged() {
		if (this.proxy instanceof HTMLTextAreaElement) {
			this.proxy.spellcheck = this.spellcheck
		}
	}
	/**
	 * Selects all the text in the text area
	 *
	 * @public
	 */
	select() {
		this.control.select()
		/**
		 * The select event does not permeate the shadow DOM boundary.
		 * This fn effectively proxies the select event,
		 * emitting a `select` event whenever the internal
		 * control emits a `select` event
		 */
		this.$emit("select")
	}
	/**
	 * Change event handler for inner control.
	 * @remarks
	 * "Change" events are not `composable` so they will not
	 * permeate the shadow DOM boundary. This fn effectively proxies
	 * the change event, emitting a `change` event whenever the internal
	 * control emits a `change` event
	 * @internal
	 */
	handleChange() {
		this.$emit("change")
	}
	/** {@inheritDoc (FormAssociated:interface).validate} */
	validate() {
		super.validate(this.control)
	}
}
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	TextArea$1.prototype,
	"readOnly",
	void 0,
)
__decorate$1([attr], TextArea$1.prototype, "resize", void 0)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	TextArea$1.prototype,
	"autofocus",
	void 0,
)
__decorate$1(
	[
		attr({
			attribute: "form",
		}),
	],
	TextArea$1.prototype,
	"formId",
	void 0,
)
__decorate$1([attr], TextArea$1.prototype, "list", void 0)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	TextArea$1.prototype,
	"maxlength",
	void 0,
)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
		}),
	],
	TextArea$1.prototype,
	"minlength",
	void 0,
)
__decorate$1([attr], TextArea$1.prototype, "name", void 0)
__decorate$1([attr], TextArea$1.prototype, "placeholder", void 0)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
			mode: "fromView",
		}),
	],
	TextArea$1.prototype,
	"cols",
	void 0,
)
__decorate$1(
	[
		attr({
			converter: nullableNumberConverter,
			mode: "fromView",
		}),
	],
	TextArea$1.prototype,
	"rows",
	void 0,
)
__decorate$1(
	[
		attr({
			mode: "boolean",
		}),
	],
	TextArea$1.prototype,
	"spellcheck",
	void 0,
)
__decorate$1([observable], TextArea$1.prototype, "defaultSlottedNodes", void 0)
applyMixins(TextArea$1, DelegatesARIATextbox)

/**
 * The template for the {@link @microsoft/fast-foundation#(TextArea:class)} component.
 * @public
 */
const textAreaTemplate = (context, definition) =>
	html`<template
		class=" ${(x) => (x.readOnly ? "readonly" : "")} ${(x) => (x.resize !== TextAreaResize.none ? `resize-${x.resize}` : "")}"
		><label
			part="label"
			for="control"
			class="${(x) => (x.defaultSlottedNodes && x.defaultSlottedNodes.length ? "label" : "label label__hidden")}"
			><slot ${slotted("defaultSlottedNodes")}></slot></label
		><textarea
			part="control"
			class="control"
			id="control"
			?autofocus="${(x) => x.autofocus}"
			cols="${(x) => x.cols}"
			?disabled="${(x) => x.disabled}"
			form="${(x) => x.form}"
			list="${(x) => x.list}"
			maxlength="${(x) => x.maxlength}"
			minlength="${(x) => x.minlength}"
			name="${(x) => x.name}"
			placeholder="${(x) => x.placeholder}"
			?readonly="${(x) => x.readOnly}"
			?required="${(x) => x.required}"
			rows="${(x) => x.rows}"
			?spellcheck="${(x) => x.spellcheck}"
			:value="${(x) => x.value}"
			aria-atomic="${(x) => x.ariaAtomic}"
			aria-busy="${(x) => x.ariaBusy}"
			aria-controls="${(x) => x.ariaControls}"
			aria-current="${(x) => x.ariaCurrent}"
			aria-describedby="${(x) => x.ariaDescribedby}"
			aria-details="${(x) => x.ariaDetails}"
			aria-disabled="${(x) => x.ariaDisabled}"
			aria-errormessage="${(x) => x.ariaErrormessage}"
			aria-flowto="${(x) => x.ariaFlowto}"
			aria-haspopup="${(x) => x.ariaHaspopup}"
			aria-hidden="${(x) => x.ariaHidden}"
			aria-invalid="${(x) => x.ariaInvalid}"
			aria-keyshortcuts="${(x) => x.ariaKeyshortcuts}"
			aria-label="${(x) => x.ariaLabel}"
			aria-labelledby="${(x) => x.ariaLabelledby}"
			aria-live="${(x) => x.ariaLive}"
			aria-owns="${(x) => x.ariaOwns}"
			aria-relevant="${(x) => x.ariaRelevant}"
			aria-roledescription="${(x) => x.ariaRoledescription}"
			@input="${(x, c) => x.handleTextInput()}"
			@change="${(x) => x.handleChange()}"
			${ref("control")}></textarea>
	</template>`

/**
 * The template for the {@link @microsoft/fast-foundation#(TextField:class)} component.
 * @public
 */
const textFieldTemplate = (context, definition) =>
	html`<template class=" ${(x) => (x.readOnly ? "readonly" : "")} "
		><label
			part="label"
			for="control"
			class="${(x) => (x.defaultSlottedNodes && x.defaultSlottedNodes.length ? "label" : "label label__hidden")}"
			><slot
				${slotted({
					property: "defaultSlottedNodes",
					filter: whitespaceFilter,
				})}></slot
		></label>
		<div class="root" part="root">
			${startSlotTemplate(context, definition)}<input
				class="control"
				part="control"
				id="control"
				@input="${(x) => x.handleTextInput()}"
				@change="${(x) => x.handleChange()}"
				?autofocus="${(x) => x.autofocus}"
				?disabled="${(x) => x.disabled}"
				list="${(x) => x.list}"
				maxlength="${(x) => x.maxlength}"
				minlength="${(x) => x.minlength}"
				pattern="${(x) => x.pattern}"
				placeholder="${(x) => x.placeholder}"
				?readonly="${(x) => x.readOnly}"
				?required="${(x) => x.required}"
				size="${(x) => x.size}"
				?spellcheck="${(x) => x.spellcheck}"
				:value="${(x) => x.value}"
				type="${(x) => x.type}"
				aria-atomic="${(x) => x.ariaAtomic}"
				aria-busy="${(x) => x.ariaBusy}"
				aria-controls="${(x) => x.ariaControls}"
				aria-current="${(x) => x.ariaCurrent}"
				aria-describedby="${(x) => x.ariaDescribedby}"
				aria-details="${(x) => x.ariaDetails}"
				aria-disabled="${(x) => x.ariaDisabled}"
				aria-errormessage="${(x) => x.ariaErrormessage}"
				aria-flowto="${(x) => x.ariaFlowto}"
				aria-haspopup="${(x) => x.ariaHaspopup}"
				aria-hidden="${(x) => x.ariaHidden}"
				aria-invalid="${(x) => x.ariaInvalid}"
				aria-keyshortcuts="${(x) => x.ariaKeyshortcuts}"
				aria-label="${(x) => x.ariaLabel}"
				aria-labelledby="${(x) => x.ariaLabelledby}"
				aria-live="${(x) => x.ariaLive}"
				aria-owns="${(x) => x.ariaOwns}"
				aria-relevant="${(x) => x.ariaRelevant}"
				aria-roledescription="${(x) => x.ariaRoledescription}"
				${ref("control")} />${endSlotTemplate(context, definition)}
		</div></template
	>`

/**
 * The CSS value for disabled cursors.
 * @public
 */
const disabledCursor = "not-allowed"

/**
 * A CSS fragment to set `display: none;` when the host is hidden using the [hidden] attribute.
 * @public
 */
const hidden = `:host([hidden]){display:none}`
/**
 * Applies a CSS display property.
 * Also adds CSS rules to not display the element when the [hidden] attribute is applied to the element.
 * @param display - The CSS display property value
 * @public
 */
function display(displayValue) {
	return `${hidden}:host{display:${displayValue}}`
}

/**
 * The string representing the focus selector to be used. Value
 * will be "focus-visible" when https://drafts.csswg.org/selectors-4/#the-focus-visible-pseudo
 * is supported and "focus" when it is not.
 *
 * @public
 */
const focusVisible = canUseFocusVisible() ? "focus-visible" : "focus"

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * Configures a MutationObserver to watch for Visual Studio Code theme changes and
 * applies the current Visual Studio Code theme to the toolkit components.
 */
function initThemeChangeListener(tokenMappings) {
	window.addEventListener("load", () => {
		const observer = new MutationObserver(() => {
			applyCurrentTheme(tokenMappings)
		})
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		})
		applyCurrentTheme(tokenMappings)
	})
}
/**
 * Applies the current Visual Studio Code theme to the toolkit components.
 */
function applyCurrentTheme(tokenMappings) {
	// Get all the styles applied to the <body> tag in the webview HTML
	// Importantly this includes all the CSS variables associated with the
	// current Visual Studio Code theme
	const styles = getComputedStyle(document.body)
	const body = document.querySelector("body")
	if (body) {
		const themeKind = body.getAttribute("data-vscode-theme-kind")
		for (const [vscodeTokenName, toolkitToken] of tokenMappings) {
			let value = styles.getPropertyValue(vscodeTokenName).toString()
			// Handle a couple of styling edge cases when a high contrast theme is applied
			if (themeKind === "vscode-high-contrast") {
				// Developer note:
				//
				// There are a handful of VS Code theme tokens that have no value when a high
				// contrast theme is applied.
				//
				// This is an issue because when no value is set the toolkit tokens will fall
				// back to their default color values (aka the VS Code dark theme color palette).
				// This results in the backgrounds of a couple of components having default dark
				// theme colors––thus breaking the high contrast theme.
				//
				// The below code, catches these tokens which have no value and are also background
				// tokens, then overrides their value to be transparent.
				if (value.length === 0 && toolkitToken.name.includes("background")) {
					value = "transparent"
				}
				// Set icon button hover to be transparent in high contrast themes
				if (toolkitToken.name === "button-icon-hover-background") {
					value = "transparent"
				}
			} else if (themeKind === "vscode-high-contrast-light") {
				if (value.length === 0 && toolkitToken.name.includes("background")) {
					// Set button variant hover backgrounds to correct values based on VS Code core source:
					// https://github.com/microsoft/vscode/blob/fd0ee4f77e354de10ae591c9e97fe5ad41b398fc/src/vs/platform/theme/common/colorRegistry.ts#L270-L276
					switch (toolkitToken.name) {
						case "button-primary-hover-background":
							value = "#0F4A85"
							break
						case "button-secondary-hover-background":
							value = "transparent"
							break
						case "button-icon-hover-background":
							value = "transparent"
							break
					}
				}
			} else {
				// Set contrast-active-border token to be transparent in non-high-contrast themes
				if (toolkitToken.name === "contrast-active-border") {
					value = "transparent"
				}
			}
			toolkitToken.setValueFor(body, value)
		}
	}
}

// Copyright (c) Microsoft Corporation.
/**
 * A mapping of all the Visual Studio Code theme CSS variables mapped to the
 * toolkit design tokens.
 */
const tokenMappings = new Map()
/**
 * Boolean flag that ensures the VS Code theme listener is initialized once.
 */
let isThemeListenerInitialized = false
/**
 * Given a design token name, return a new FAST CSSDesignToken.
 *
 * @remarks A VS Code theme CSS variable can be optionally passed to be
 * associated with the design token.
 *
 * @remarks On the first execution the VS Code theme listener will also be
 * initialized.
 *
 * @param name A design token name.
 * @param vscodeThemeVar A VS Code theme CSS variable name to be associated with
 * the design token.
 * @returns A FAST CSSDesignToken that emits a CSS custom property.
 */
function create(name, vscodeThemeVar) {
	const designToken = DesignToken.create(name)
	if (vscodeThemeVar) {
		// If the fake vscode token is passed in, attach a unique ID to it so that it can
		// be added to the tokenMappings map without overriding a previous fake token value
		if (vscodeThemeVar.includes("--fake-vscode-token")) {
			const uniqueId = "id" + Math.random().toString(16).slice(2)
			vscodeThemeVar = `${vscodeThemeVar}-${uniqueId}`
		}
		tokenMappings.set(vscodeThemeVar, designToken)
	}
	if (!isThemeListenerInitialized) {
		initThemeChangeListener(tokenMappings)
		isThemeListenerInitialized = true
	}
	return designToken
}

// Copyright (c) Microsoft Corporation.
/**
 * Developer note:
 *
 * There are some tokens defined in this file that make use of `--fake-vscode-token`. This is
 * done when a toolkit token should be added to the tokenMappings map (and subsequently altered
 * in the applyTheme function) but does not have a corresponding VS Code token that can be used.
 *
 * An example is buttonIconHoverBackground token which does not have a corresponding VS Code token
 * at this time (it's a hardcoded value in VS Code), but needs to be adjusted to be transparent when a
 * high contrast theme is applied.
 *
 * As a rule of thumb, if there are special cases where a token needs to be adjusted based on the
 * VS Code theme and does not have a corresponding VS Code token, `--fake-vscode-token` can be used
 * to indicate that it should be added to the tokenMappings map and thus make it accessible to the
 * applyTheme function where it can be dynamically adjusted.
 */
/**
 * Global design tokens.
 */
const background = create("background", "--vscode-editor-background").withDefault("#1e1e1e")
const borderWidth = create("border-width").withDefault(1)
const contrastActiveBorder = create("contrast-active-border", "--vscode-contrastActiveBorder").withDefault("#f38518")
create("contrast-border", "--vscode-contrastBorder").withDefault("#6fc3df")
const cornerRadius = create("corner-radius").withDefault(0)
const cornerRadiusRound = create("corner-radius-round").withDefault(2)
const designUnit = create("design-unit").withDefault(4)
const disabledOpacity = create("disabled-opacity").withDefault(0.4)
const focusBorder = create("focus-border", "--vscode-focusBorder").withDefault("#007fd4")
const fontFamily = create("font-family", "--vscode-font-family").withDefault(
	"-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol",
)
create("font-weight", "--vscode-font-weight").withDefault("400")
const foreground = create("foreground", "--vscode-foreground").withDefault("#cccccc")
const inputHeight = create("input-height").withDefault("26")
const inputMinWidth = create("input-min-width").withDefault("100px")
const typeRampBaseFontSize = create("type-ramp-base-font-size", "--vscode-font-size").withDefault("13px")
const typeRampBaseLineHeight = create("type-ramp-base-line-height").withDefault("normal")
const typeRampMinus1FontSize = create("type-ramp-minus1-font-size").withDefault("11px")
const typeRampMinus1LineHeight = create("type-ramp-minus1-line-height").withDefault("16px")
create("type-ramp-minus2-font-size").withDefault("9px")
create("type-ramp-minus2-line-height").withDefault("16px")
create("type-ramp-plus1-font-size").withDefault("16px")
create("type-ramp-plus1-line-height").withDefault("24px")
const scrollbarWidth = create("scrollbarWidth").withDefault("10px")
const scrollbarHeight = create("scrollbarHeight").withDefault("10px")
const scrollbarSliderBackground = create("scrollbar-slider-background", "--vscode-scrollbarSlider-background").withDefault(
	"#79797966",
)
const scrollbarSliderHoverBackground = create(
	"scrollbar-slider-hover-background",
	"--vscode-scrollbarSlider-hoverBackground",
).withDefault("#646464b3")
const scrollbarSliderActiveBackground = create(
	"scrollbar-slider-active-background",
	"--vscode-scrollbarSlider-activeBackground",
).withDefault("#bfbfbf66")
/**
 * Badge design tokens.
 */
const badgeBackground = create("badge-background", "--vscode-badge-background").withDefault("#4d4d4d")
const badgeForeground = create("badge-foreground", "--vscode-badge-foreground").withDefault("#ffffff")
/**
 * Button design tokens.
 */
// Note: Button border is used only for high contrast themes and should be left as transparent otherwise.
const buttonBorder = create("button-border", "--vscode-button-border").withDefault("transparent")
const buttonIconBackground = create("button-icon-background").withDefault("transparent")
const buttonIconCornerRadius = create("button-icon-corner-radius").withDefault("5px")
const buttonIconFocusBorderOffset = create("button-icon-outline-offset").withDefault(0)
// Note usage of `--fake-vscode-token` (refer to doc comment at top of file for explanation).
const buttonIconHoverBackground = create("button-icon-hover-background", "--fake-vscode-token").withDefault(
	"rgba(90, 93, 94, 0.31)",
)
const buttonIconPadding = create("button-icon-padding").withDefault("3px")
const buttonPrimaryBackground = create("button-primary-background", "--vscode-button-background").withDefault("#0e639c")
const buttonPrimaryForeground = create("button-primary-foreground", "--vscode-button-foreground").withDefault("#ffffff")
const buttonPrimaryHoverBackground = create("button-primary-hover-background", "--vscode-button-hoverBackground").withDefault(
	"#1177bb",
)
const buttonSecondaryBackground = create("button-secondary-background", "--vscode-button-secondaryBackground").withDefault(
	"#3a3d41",
)
const buttonSecondaryForeground = create("button-secondary-foreground", "--vscode-button-secondaryForeground").withDefault(
	"#ffffff",
)
const buttonSecondaryHoverBackground = create(
	"button-secondary-hover-background",
	"--vscode-button-secondaryHoverBackground",
).withDefault("#45494e")
const buttonPaddingHorizontal = create("button-padding-horizontal").withDefault("11px")
const buttonPaddingVertical = create("button-padding-vertical").withDefault("4px")
/**
 * Checkbox design tokens.
 */
const checkboxBackground = create("checkbox-background", "--vscode-checkbox-background").withDefault("#3c3c3c")
const checkboxBorder = create("checkbox-border", "--vscode-checkbox-border").withDefault("#3c3c3c")
const checkboxCornerRadius = create("checkbox-corner-radius").withDefault(3)
create("checkbox-foreground", "--vscode-checkbox-foreground").withDefault("#f0f0f0")
/**
 * Data Grid design tokens
 */
const listActiveSelectionBackground = create(
	"list-active-selection-background",
	"--vscode-list-activeSelectionBackground",
).withDefault("#094771")
const listActiveSelectionForeground = create(
	"list-active-selection-foreground",
	"--vscode-list-activeSelectionForeground",
).withDefault("#ffffff")
const listHoverBackground = create("list-hover-background", "--vscode-list-hoverBackground").withDefault("#2a2d2e")
/**
 * Divider design tokens.
 */
const dividerBackground = create("divider-background", "--vscode-settings-dropdownListBorder").withDefault("#454545")
/**
 * Dropdown design tokens.
 */
const dropdownBackground = create("dropdown-background", "--vscode-dropdown-background").withDefault("#3c3c3c")
const dropdownBorder = create("dropdown-border", "--vscode-dropdown-border").withDefault("#3c3c3c")
create("dropdown-foreground", "--vscode-dropdown-foreground").withDefault("#f0f0f0")
const dropdownListMaxHeight = create("dropdown-list-max-height").withDefault("200px")
/**
 * Text Field & Area design tokens.
 */
const inputBackground = create("input-background", "--vscode-input-background").withDefault("#3c3c3c")
const inputForeground = create("input-foreground", "--vscode-input-foreground").withDefault("#cccccc")
create("input-placeholder-foreground", "--vscode-input-placeholderForeground").withDefault("#cccccc")
/**
 * Link design tokens.
 */
const linkActiveForeground = create("link-active-foreground", "--vscode-textLink-activeForeground").withDefault("#3794ff")
const linkForeground = create("link-foreground", "--vscode-textLink-foreground").withDefault("#3794ff")
/**
 * Progress ring design tokens.
 */
const progressBackground = create("progress-background", "--vscode-progressBar-background").withDefault("#0e70c0")
/**
 * Panels design tokens.
 */
const panelTabActiveBorder = create("panel-tab-active-border", "--vscode-panelTitle-activeBorder").withDefault("#e7e7e7")
const panelTabActiveForeground = create("panel-tab-active-foreground", "--vscode-panelTitle-activeForeground").withDefault(
	"#e7e7e7",
)
const panelTabForeground = create("panel-tab-foreground", "--vscode-panelTitle-inactiveForeground").withDefault("#e7e7e799")
create("panel-view-background", "--vscode-panel-background").withDefault("#1e1e1e")
create("panel-view-border", "--vscode-panel-border").withDefault("#80808059")
/**
 * Tag design tokens.
 */
const tagCornerRadius = create("tag-corner-radius").withDefault("2px")

// Copyright (c) Microsoft Corporation.
const badgeStyles = (context, definition) => css`
	${display("inline-block")} :host {
		box-sizing: border-box;
		font-family: ${fontFamily};
		font-size: ${typeRampMinus1FontSize};
		line-height: ${typeRampMinus1LineHeight};
		text-align: center;
	}
	.control {
		align-items: center;
		background-color: ${badgeBackground};
		border: calc(${borderWidth} * 1px) solid ${buttonBorder};
		border-radius: 11px;
		box-sizing: border-box;
		color: ${badgeForeground};
		display: flex;
		height: calc(${designUnit} * 4px);
		justify-content: center;
		min-width: calc(${designUnit} * 4px + 2px);
		min-height: calc(${designUnit} * 4px + 2px);
		padding: 3px 6px;
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code badge class.
 *
 * @public
 */
class Badge extends Badge$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// This will override any usage of the circular attribute
		// inherited by the FAST Foundation Badge component so
		// that VSCode Badges are always circular
		if (!this.circular) {
			this.circular = true
		}
	}
}
/**
 * The Visual Studio Code badge component registration.
 *
 * @remarks
 * HTML Element: `<vscode-badge>`
 *
 * @public
 */
const vsCodeBadge = Badge.compose({
	baseName: "badge",
	template: badgeTemplate,
	styles: badgeStyles,
})

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
function __decorate(decorators, target, key, desc) {
	var c = arguments.length,
		r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
		d
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc)
	else
		for (var i = decorators.length - 1; i >= 0; i--)
			if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r
	return c > 3 && r && Object.defineProperty(target, key, r), r
}
typeof SuppressedError === "function"
	? SuppressedError
	: function (error, suppressed, message) {
			var e = new Error(message)
			return (e.name = "SuppressedError"), (e.error = error), (e.suppressed = suppressed), e
		}

// Copyright (c) Microsoft Corporation.
/**
 * Developer note:
 *
 * The prettier-ignore command is used on this block of code because when removed the
 * '.control:${focusVisible}' CSS selector will be automatically reformatted to
 * '.control: ${focusVisible}' (note the space between the colon and dollar sign).
 *
 * This results in non-valid CSS that will not render a focus outline on base buttons.
 *
 * Additionally, this prettier command must be declared on the entire code block and not
 * directly above the CSS selector line because the below code block is a template literal
 * string which will end up being used directly in the final component CSS.
 *
 * Thus having '// prettier-ignore' directly in the final CSS will also break the component
 * styling.
 *
 * @internal
 */
// prettier-ignore
const BaseButtonStyles = css` ${display('inline-flex')} :host{outline: none;font-family: ${fontFamily};font-size: ${typeRampBaseFontSize};line-height: ${typeRampBaseLineHeight};color: ${buttonPrimaryForeground};background: ${buttonPrimaryBackground};border-radius: calc(${cornerRadiusRound} * 1px);fill: currentColor;cursor: pointer}.control{background: transparent;height: inherit;flex-grow: 1;box-sizing: border-box;display: inline-flex;justify-content: center;align-items: center;padding: ${buttonPaddingVertical} ${buttonPaddingHorizontal};white-space: wrap;outline: none;text-decoration: none;border: calc(${borderWidth} * 1px) solid ${buttonBorder};color: inherit;border-radius: inherit;fill: inherit;cursor: inherit;font-family: inherit}:host(:hover){background: ${buttonPrimaryHoverBackground}}:host(:active){background: ${buttonPrimaryBackground}}.control:${focusVisible}{outline: calc(${borderWidth} * 1px) solid ${focusBorder};outline-offset: calc(${borderWidth} * 2px)}.control::-moz-focus-inner{border: 0}:host([disabled]){opacity: ${disabledOpacity};background: ${buttonPrimaryBackground};cursor: ${disabledCursor}}.content{display: flex}.start{display: flex}::slotted(svg),	::slotted(span){width: calc(${designUnit} * 4px);height: calc(${designUnit} * 4px)}.start{margin-inline-end: 8px}`;
/**
 * @internal
 */
const PrimaryButtonStyles = css`
	:host([appearance="primary"]) {
		background: ${buttonPrimaryBackground};
		color: ${buttonPrimaryForeground};
	}
	:host([appearance="primary"]:hover) {
		background: ${buttonPrimaryHoverBackground};
	}
	:host([appearance="primary"]:active) .control:active {
		background: ${buttonPrimaryBackground};
	}
	:host([appearance='primary']) .control:${focusVisible} {
		outline: calc(${borderWidth} * 1px) solid ${focusBorder};
		outline-offset: calc(${borderWidth} * 2px);
	}
	:host([appearance="primary"][disabled]) {
		background: ${buttonPrimaryBackground};
	}
`
/**
 * @internal
 */
const SecondaryButtonStyles = css`
	:host([appearance="secondary"]) {
		background: ${buttonSecondaryBackground};
		color: ${buttonSecondaryForeground};
	}
	:host([appearance="secondary"]:hover) {
		background: ${buttonSecondaryHoverBackground};
	}
	:host([appearance="secondary"]:active) .control:active {
		background: ${buttonSecondaryBackground};
	}
	:host([appearance='secondary']) .control:${focusVisible} {
		outline: calc(${borderWidth} * 1px) solid ${focusBorder};
		outline-offset: calc(${borderWidth} * 2px);
	}
	:host([appearance="secondary"][disabled]) {
		background: ${buttonSecondaryBackground};
	}
`
/**
 * @internal
 */
const IconButtonStyles = css`
	:host([appearance="icon"]) {
		background: ${buttonIconBackground};
		border-radius: ${buttonIconCornerRadius};
		color: ${foreground};
	}
	:host([appearance="icon"]:hover) {
		background: ${buttonIconHoverBackground};
		outline: 1px dotted ${contrastActiveBorder};
		outline-offset: -1px;
	}
	:host([appearance="icon"]) .control {
		padding: ${buttonIconPadding};
		border: none;
	}
	:host([appearance="icon"]:active) .control:active {
		background: ${buttonIconHoverBackground};
	}
	:host([appearance='icon']) .control:${focusVisible} {
		outline: calc(${borderWidth} * 1px) solid ${focusBorder};
		outline-offset: ${buttonIconFocusBorderOffset};
	}
	:host([appearance="icon"][disabled]) {
		background: ${buttonIconBackground};
	}
`
const buttonStyles = (context, definition) => css`
	${BaseButtonStyles} ${PrimaryButtonStyles} ${SecondaryButtonStyles} ${IconButtonStyles}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code button class.
 *
 * @public
 */
class Button extends Button$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// If the appearance property has not been set, set it to the
		// value of the appearance attribute.
		if (!this.appearance) {
			const appearanceValue = this.getAttribute("appearance")
			this.appearance = appearanceValue
		}
	}
	/**
	 * Component lifecycle method that runs when an attribute of the
	 * element is changed.
	 *
	 * @param attrName - The attribute that was changed
	 * @param oldVal - The old value of the attribute
	 * @param newVal - The new value of the attribute
	 *
	 * @internal
	 */
	attributeChangedCallback(attrName, oldVal, newVal) {
		// In the case when an icon only button is created add a default ARIA
		// label to the button since there is no longer button text to use
		// as the label
		if (attrName === "appearance" && newVal === "icon") {
			// Only set the ARIA label to the default text if an aria-label attribute
			// does not exist on the button
			const ariaLabelValue = this.getAttribute("aria-label")
			if (!ariaLabelValue) {
				this.ariaLabel = "Icon Button"
			}
		}
		// In the case when the aria-label attribute has been defined on the
		// <vscode-button>, this will programmatically propogate the value to
		// the <button> HTML element that lives in the Shadow DOM
		if (attrName === "aria-label") {
			this.ariaLabel = newVal
		}
		if (attrName === "disabled") {
			this.disabled = newVal !== null
		}
	}
}
__decorate([attr], Button.prototype, "appearance", void 0)
/**
 * The Visual Studio Code button component registration.
 *
 * @remarks
 * HTML Element: `<vscode-button>`
 *
 * @public
 */
const vsCodeButton = Button.compose({
	baseName: "button",
	template: buttonTemplate,
	styles: buttonStyles,
	shadowOptions: {
		delegatesFocus: true,
	},
})

// Copyright (c) Microsoft Corporation.
const checkboxStyles = (context, defintiion) => css`
	${display("inline-flex")} :host {
		align-items: center;
		outline: none;
		margin: calc(${designUnit} * 1px) 0;
		user-select: none;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
	}
	.control {
		position: relative;
		width: calc(${designUnit} * 4px + 2px);
		height: calc(${designUnit} * 4px + 2px);
		box-sizing: border-box;
		border-radius: calc(${checkboxCornerRadius} * 1px);
		border: calc(${borderWidth} * 1px) solid ${checkboxBorder};
		background: ${checkboxBackground};
		outline: none;
		cursor: pointer;
	}
	.label {
		font-family: ${fontFamily};
		color: ${foreground};
		padding-inline-start: calc(${designUnit} * 2px + 2px);
		margin-inline-end: calc(${designUnit} * 2px + 2px);
		cursor: pointer;
	}
	.label__hidden {
		display: none;
		visibility: hidden;
	}
	.checked-indicator {
		width: 100%;
		height: 100%;
		display: block;
		fill: ${foreground};
		opacity: 0;
		pointer-events: none;
	}
	.indeterminate-indicator {
		border-radius: 2px;
		background: ${foreground};
		position: absolute;
		top: 50%;
		left: 50%;
		width: 50%;
		height: 50%;
		transform: translate(-50%, -50%);
		opacity: 0;
	}
	:host(:enabled) .control:hover {
		background: ${checkboxBackground};
		border-color: ${checkboxBorder};
	}
	:host(:enabled) .control:active {
		background: ${checkboxBackground};
		border-color: ${focusBorder};
	}
	:host(:${focusVisible}) .control {
		border: calc(${borderWidth} * 1px) solid ${focusBorder};
	}
	:host(.disabled) .label,
	:host(.readonly) .label,
	:host(.readonly) .control,
	:host(.disabled) .control {
		cursor: ${disabledCursor};
	}
	:host(.checked:not(.indeterminate)) .checked-indicator,
	:host(.indeterminate) .indeterminate-indicator {
		opacity: 1;
	}
	:host(.disabled) {
		opacity: ${disabledOpacity};
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code checkbox class.
 *
 * @public
 */
class Checkbox extends Checkbox$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		if (this.textContent) {
			this.setAttribute("aria-label", this.textContent)
		} else {
			// Fallback to the label if there is no text content
			this.setAttribute("aria-label", "Checkbox")
		}
	}
}
/**
 * The Visual Studio Code checkbox component registration.
 *
 * @remarks
 * HTML Element: `<vscode-checkbox>`
 *
 * @public
 */
const vsCodeCheckbox = Checkbox.compose({
	baseName: "checkbox",
	template: checkboxTemplate,
	styles: checkboxStyles,
	checkedIndicator: `
		<svg 
			part="checked-indicator"
			class="checked-indicator"
			width="16" 
			height="16" 
			viewBox="0 0 16 16" 
			xmlns="http://www.w3.org/2000/svg" 
			fill="currentColor"
		>
			<path 
				fill-rule="evenodd" 
				clip-rule="evenodd" 
				d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z"
			/>
		</svg>
	`,
	indeterminateIndicator: `
		<div part="indeterminate-indicator" class="indeterminate-indicator"></div>
	`,
})

// Copyright (c) Microsoft Corporation.
const dataGridStyles = (context, definition) => css`
	:host {
		display: flex;
		position: relative;
		flex-direction: column;
		width: 100%;
	}
`

// Copyright (c) Microsoft Corporation.
const dataGridRowStyles = (context, definition) => css`
	:host {
		display: grid;
		padding: calc((${designUnit} / 4) * 1px) 0;
		box-sizing: border-box;
		width: 100%;
		background: transparent;
	}
	:host(.header) {
	}
	:host(.sticky-header) {
		background: ${background};
		position: sticky;
		top: 0;
	}
	:host(:hover) {
		background: ${listHoverBackground};
		outline: 1px dotted ${contrastActiveBorder};
		outline-offset: -1px;
	}
`

// Copyright (c) Microsoft Corporation.
const dataGridCellStyles = (context, definition) => css`
	:host {
		padding: calc(${designUnit} * 1px) calc(${designUnit} * 3px);
		color: ${foreground};
		opacity: 1;
		box-sizing: border-box;
		font-family: ${fontFamily};
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		font-weight: 400;
		border: solid calc(${borderWidth} * 1px) transparent;
		border-radius: calc(${cornerRadius} * 1px);
		white-space: wrap;
		overflow-wrap: anywhere;
	}
	:host(.column-header) {
		font-weight: 600;
	}
	:host(:${focusVisible}),	:host(:focus),	:host(:active) {
		background: ${listActiveSelectionBackground};
		border: solid calc(${borderWidth} * 1px) ${focusBorder};
		color: ${listActiveSelectionForeground};
		outline: none;
	}
	:host(:${focusVisible}) ::slotted(*),	:host(:focus) ::slotted(*),	:host(:active) ::slotted(*) {
		color: ${listActiveSelectionForeground} !important;
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code data grid class.
 *
 * @public
 */
class DataGrid extends DataGrid$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// Sets a default ARIA label on the data grid only if an aria-label attribute
		// does not already exist
		const ariaLabelValue = this.getAttribute("aria-label")
		if (!ariaLabelValue) {
			this.setAttribute("aria-label", "Data Grid")
		}
	}
}
/**
 * The Visual Studio Code data grid component registration.
 *
 * @remarks
 * HTML Element: `<vscode-data-grid>`
 *
 * @public
 */
const vsCodeDataGrid = DataGrid.compose({
	baseName: "data-grid",
	baseClass: DataGrid$1,
	template: dataGridTemplate,
	styles: dataGridStyles,
})
/**
 * The Visual Studio Code data grid row class.
 *
 * @public
 */
class DataGridRow extends DataGridRow$1 {}
/**
 * The Visual Studio Code data grid row component registration.
 *
 * @remarks
 * HTML Element: `<vscode-data-grid-row>`
 *
 * @public
 */
const vsCodeDataGridRow = DataGridRow.compose({
	baseName: "data-grid-row",
	baseClass: DataGridRow$1,
	template: dataGridRowTemplate,
	styles: dataGridRowStyles,
})
/**
 * The Visual Studio Code data grid cell class.
 *
 * @public
 */
class DataGridCell extends DataGridCell$1 {}
/**
 * The Visual Studio Code data grid cell component registration.
 *
 * @remarks
 * HTML Element: `<vscode-data-grid-cell>`
 *
 * @public
 */
const vsCodeDataGridCell = DataGridCell.compose({
	baseName: "data-grid-cell",
	baseClass: DataGridCell$1,
	template: dataGridCellTemplate,
	styles: dataGridCellStyles,
})

// Copyright (c) Microsoft Corporation.
const dividerStyles = (context, definition) => css`
	${display("block")} :host {
		border: none;
		border-top: calc(${borderWidth} * 1px) solid ${dividerBackground};
		box-sizing: content-box;
		height: 0;
		margin: calc(${designUnit} * 1px) 0;
		width: 100%;
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code divider class.
 *
 * @public
 */
class Divider extends Divider$1 {}
/**
 * The Visual Studio Code divider component registration.
 *
 * @remarks
 * HTML Element: `<vscode-divider>`
 *
 * @public
 */
const vsCodeDivider = Divider.compose({
	baseName: "divider",
	template: dividerTemplate,
	styles: dividerStyles,
})

// Copyright (c) Microsoft Corporation.
const dropdownStyles = (context, definition) => css`
	${display("inline-flex")} :host {
		background: ${dropdownBackground};
		border-radius: calc(${cornerRadiusRound} * 1px);
		box-sizing: border-box;
		color: ${foreground};
		contain: contents;
		font-family: ${fontFamily};
		height: calc(${inputHeight} * 1px);
		position: relative;
		user-select: none;
		min-width: ${inputMinWidth};
		outline: none;
		vertical-align: top;
	}
	.control {
		align-items: center;
		box-sizing: border-box;
		border: calc(${borderWidth} * 1px) solid ${dropdownBorder};
		border-radius: calc(${cornerRadiusRound} * 1px);
		cursor: pointer;
		display: flex;
		font-family: inherit;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		min-height: 100%;
		padding: 2px 6px 2px 8px;
		width: 100%;
	}
	.listbox {
		background: ${dropdownBackground};
		border: calc(${borderWidth} * 1px) solid ${focusBorder};
		border-radius: calc(${cornerRadiusRound} * 1px);
		box-sizing: border-box;
		display: inline-flex;
		flex-direction: column;
		left: 0;
		max-height: ${dropdownListMaxHeight};
		padding: 0;
		overflow-y: auto;
		position: absolute;
		width: 100%;
		z-index: 1;
	}
	.listbox[hidden] {
		display: none;
	}
	:host(:${focusVisible}) .control {
		border-color: ${focusBorder};
	}
	:host(:not([disabled]):hover) {
		background: ${dropdownBackground};
		border-color: ${dropdownBorder};
	}
	:host(:${focusVisible}) ::slotted([aria-selected="true"][role="option"]:not([disabled])) {
		background: ${listActiveSelectionBackground};
		border: calc(${borderWidth} * 1px) solid transparent;
		color: ${listActiveSelectionForeground};
	}
	:host([disabled]) {
		cursor: ${disabledCursor};
		opacity: ${disabledOpacity};
	}
	:host([disabled]) .control {
		cursor: ${disabledCursor};
		user-select: none;
	}
	:host([disabled]:hover) {
		background: ${dropdownBackground};
		color: ${foreground};
		fill: currentcolor;
	}
	:host(:not([disabled])) .control:active {
		border-color: ${focusBorder};
	}
	:host(:empty) .listbox {
		display: none;
	}
	:host([open]) .control {
		border-color: ${focusBorder};
	}
	:host([open][position="above"]) .listbox {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}
	:host([open][position="below"]) .listbox {
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}
	:host([open][position="above"]) .listbox {
		bottom: calc(${inputHeight} * 1px);
	}
	:host([open][position="below"]) .listbox {
		top: calc(${inputHeight} * 1px);
	}
	.selected-value {
		flex: 1 1 auto;
		font-family: inherit;
		overflow: hidden;
		text-align: start;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.indicator {
		flex: 0 0 auto;
		margin-inline-start: 1em;
	}
	slot[name="listbox"] {
		display: none;
		width: 100%;
	}
	:host([open]) slot[name="listbox"] {
		display: flex;
		position: absolute;
	}
	.end {
		margin-inline-start: auto;
	}
	.start,
	.end,
	.indicator,
	.select-indicator,
	::slotted(svg),
	::slotted(span) {
		fill: currentcolor;
		height: 1em;
		min-height: calc(${designUnit} * 4px);
		min-width: calc(${designUnit} * 4px);
		width: 1em;
	}
	::slotted([role="option"]),
	::slotted(option) {
		flex: 0 0 auto;
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code dropdown class.
 *
 * @public
 */
class Dropdown extends Select {}
/**
 * The Visual Studio Code link dropdown registration.
 *
 * @remarks
 * HTML Element: `<vscode-dropdown>`
 *
 * @public
 */
const vsCodeDropdown = Dropdown.compose({
	baseName: "dropdown",
	template: selectTemplate,
	styles: dropdownStyles,
	indicator: `
		<svg 
			class="select-indicator"
			part="select-indicator"
			width="16" 
			height="16" 
			viewBox="0 0 16 16" 
			xmlns="http://www.w3.org/2000/svg" 
			fill="currentColor"
		>
			<path 
				fill-rule="evenodd" 
				clip-rule="evenodd" 
				d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"
			/>
		</svg>
	`,
})

// Copyright (c) Microsoft Corporation.
const linkStyles = (context, definition) => css`
	${display("inline-flex")} :host {
		background: transparent;
		box-sizing: border-box;
		color: ${linkForeground};
		cursor: pointer;
		fill: currentcolor;
		font-family: ${fontFamily};
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		outline: none;
	}
	.control {
		background: transparent;
		border: calc(${borderWidth} * 1px) solid transparent;
		border-radius: calc(${cornerRadius} * 1px);
		box-sizing: border-box;
		color: inherit;
		cursor: inherit;
		fill: inherit;
		font-family: inherit;
		height: inherit;
		padding: 0;
		outline: none;
		text-decoration: none;
		word-break: break-word;
	}
	.control::-moz-focus-inner {
		border: 0;
	}
	:host(:hover) {
		color: ${linkActiveForeground};
	}
	:host(:hover) .content {
		text-decoration: underline;
	}
	:host(:active) {
		background: transparent;
		color: ${linkActiveForeground};
	}
	:host(:${focusVisible}) .control,	:host(:focus) .control {
		border: calc(${borderWidth} * 1px) solid ${focusBorder};
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code link class.
 *
 * @public
 */
class Link extends Anchor {}
/**
 * The Visual Studio Code link component registration.
 *
 * @remarks
 * HTML Element: `<vscode-link>`
 *
 * @public
 */
const vsCodeLink = Link.compose({
	baseName: "link",
	template: anchorTemplate,
	styles: linkStyles,
	shadowOptions: {
		delegatesFocus: true,
	},
})

// Copyright (c) Microsoft Corporation.
const optionStyles = (context, definition) => css`
	${display("inline-flex")} :host {
		font-family: var(--body-font);
		border-radius: ${cornerRadius};
		border: calc(${borderWidth} * 1px) solid transparent;
		box-sizing: border-box;
		color: ${foreground};
		cursor: pointer;
		fill: currentcolor;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		margin: 0;
		outline: none;
		overflow: hidden;
		padding: 0 calc((${designUnit} / 2) * 1px) calc((${designUnit} / 4) * 1px);
		user-select: none;
		white-space: nowrap;
	}
	:host(:${focusVisible}) {
		border-color: ${focusBorder};
		background: ${listActiveSelectionBackground};
		color: ${foreground};
	}
	:host([aria-selected="true"]) {
		background: ${listActiveSelectionBackground};
		border: calc(${borderWidth} * 1px) solid transparent;
		color: ${listActiveSelectionForeground};
	}
	:host(:active) {
		background: ${listActiveSelectionBackground};
		color: ${listActiveSelectionForeground};
	}
	:host(:not([aria-selected="true"]):hover) {
		background: ${listActiveSelectionBackground};
		border: calc(${borderWidth} * 1px) solid transparent;
		color: ${listActiveSelectionForeground};
	}
	:host(:not([aria-selected="true"]):active) {
		background: ${listActiveSelectionBackground};
		color: ${foreground};
	}
	:host([disabled]) {
		cursor: ${disabledCursor};
		opacity: ${disabledOpacity};
	}
	:host([disabled]:hover) {
		background-color: inherit;
	}
	.content {
		grid-column-start: 2;
		justify-self: start;
		overflow: hidden;
		text-overflow: ellipsis;
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code option class.
 *
 * @public
 */
class Option$1 extends ListboxOption {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		if (this.textContent) {
			this.setAttribute("aria-label", this.textContent)
		} else {
			// Fallback to the label if there is no text content
			this.setAttribute("aria-label", "Option")
		}
	}
}
/**
 * The Visual Studio Code option component registration.
 *
 * @remarks
 * HTML Element: `<vscode-option>`
 *
 * @public
 */
const vsCodeOption = Option$1.compose({
	baseName: "option",
	template: listboxOptionTemplate,
	styles: optionStyles,
})

// Copyright (c) Microsoft Corporation.
const panelsStyles = (context, definition) => css`
	${display("grid")} :host {
		box-sizing: border-box;
		font-family: ${fontFamily};
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		color: ${foreground};
		grid-template-columns: auto 1fr auto;
		grid-template-rows: auto 1fr;
		overflow-x: auto;
	}
	.tablist {
		display: grid;
		grid-template-rows: auto auto;
		grid-template-columns: auto;
		column-gap: calc(${designUnit} * 8px);
		position: relative;
		width: max-content;
		align-self: end;
		padding: calc(${designUnit} * 1px) calc(${designUnit} * 1px) 0;
		box-sizing: border-box;
	}
	.start,
	.end {
		align-self: center;
	}
	.activeIndicator {
		grid-row: 2;
		grid-column: 1;
		width: 100%;
		height: calc((${designUnit} / 4) * 1px);
		justify-self: center;
		background: ${panelTabActiveForeground};
		margin: 0;
		border-radius: calc(${cornerRadius} * 1px);
	}
	.activeIndicatorTransition {
		transition: transform 0.01s linear;
	}
	.tabpanel {
		grid-row: 2;
		grid-column-start: 1;
		grid-column-end: 4;
		position: relative;
	}
`

// Copyright (c) Microsoft Corporation.
const panelTabStyles = (context, definition) => css`
	${display("inline-flex")} :host {
		box-sizing: border-box;
		font-family: ${fontFamily};
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		height: calc(${designUnit} * 7px);
		padding: calc(${designUnit} * 1px) 0;
		color: ${panelTabForeground};
		fill: currentcolor;
		border-radius: calc(${cornerRadius} * 1px);
		border: solid calc(${borderWidth} * 1px) transparent;
		align-items: center;
		justify-content: center;
		grid-row: 1;
		cursor: pointer;
	}
	:host(:hover) {
		color: ${panelTabActiveForeground};
		fill: currentcolor;
	}
	:host(:active) {
		color: ${panelTabActiveForeground};
		fill: currentcolor;
	}
	:host([aria-selected="true"]) {
		background: transparent;
		color: ${panelTabActiveForeground};
		fill: currentcolor;
	}
	:host([aria-selected="true"]:hover) {
		background: transparent;
		color: ${panelTabActiveForeground};
		fill: currentcolor;
	}
	:host([aria-selected="true"]:active) {
		background: transparent;
		color: ${panelTabActiveForeground};
		fill: currentcolor;
	}
	:host(:${focusVisible}) {
		outline: none;
		border: solid calc(${borderWidth} * 1px) ${panelTabActiveBorder};
	}
	:host(:focus) {
		outline: none;
	}
	::slotted(vscode-badge) {
		margin-inline-start: calc(${designUnit} * 2px);
	}
`

// Copyright (c) Microsoft Corporation.
const panelViewStyles = (context, definition) => css`
	${display("flex")} :host {
		color: inherit;
		background-color: transparent;
		border: solid calc(${borderWidth} * 1px) transparent;
		box-sizing: border-box;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		padding: 10px calc((${designUnit} + 2) * 1px);
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code panels class.
 *
 * @public
 */
class Panels extends Tabs {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// This will override any usage of the orientation attribute
		// inherited by the FAST Foundation Tabs component so that
		// VSCodePanels are always oriented horizontally
		if (this.orientation) {
			this.orientation = TabsOrientation.horizontal
		}
		// Sets a default ARIA label on the panels component only if an
		// aria-label attribute does not already exist
		const ariaLabelValue = this.getAttribute("aria-label")
		if (!ariaLabelValue) {
			this.setAttribute("aria-label", "Panels")
		}
	}
}
/**
 * The Visual Studio Code panels component registration.
 *
 * @remarks
 * HTML Element: `<vscode-panels>`
 *
 * @public
 */
const vsCodePanels = Panels.compose({
	baseName: "panels",
	template: tabsTemplate,
	styles: panelsStyles,
})
/**
 * The Visual Studio Code panel tab class.
 *
 * @public
 */
class PanelTab extends Tab {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// This will override any usage of the disabled attribute
		// inherited by the FAST Foundation Tab component so that
		// VSCodePanelTab can never be disabled
		if (this.disabled) {
			this.disabled = false
		}
		if (this.textContent) {
			this.setAttribute("aria-label", this.textContent)
		}
	}
}
/**
 * The Visual Studio Code panel tab component registration.
 *
 * @remarks
 * HTML Element: `<vscode-panel-tab>`
 *
 * @public
 */
const vsCodePanelTab = PanelTab.compose({
	baseName: "panel-tab",
	template: tabTemplate,
	styles: panelTabStyles,
})
/**
 * The Visual Studio Code panel view class.
 *
 * @public
 */
class PanelView extends TabPanel {}
/**
 * The Visual Studio Code panel view component registration.
 *
 * @remarks
 * HTML Element: `<vscode-panel-view>`
 *
 * @public
 */
const vsCodePanelView = PanelView.compose({
	baseName: "panel-view",
	template: tabPanelTemplate,
	styles: panelViewStyles,
})

// Copyright (c) Microsoft Corporation.
const progressRingStyles = (context, definition) => css`
	${display("flex")} :host {
		align-items: center;
		outline: none;
		height: calc(${designUnit} * 7px);
		width: calc(${designUnit} * 7px);
		margin: 0;
	}
	.progress {
		height: 100%;
		width: 100%;
	}
	.background {
		fill: none;
		stroke: transparent;
		stroke-width: calc(${designUnit} / 2 * 1px);
	}
	.indeterminate-indicator-1 {
		fill: none;
		stroke: ${progressBackground};
		stroke-width: calc(${designUnit} / 2 * 1px);
		stroke-linecap: square;
		transform-origin: 50% 50%;
		transform: rotate(-90deg);
		transition: all 0.2s ease-in-out;
		animation: spin-infinite 2s linear infinite;
	}
	@keyframes spin-infinite {
		0% {
			stroke-dasharray: 0.01px 43.97px;
			transform: rotate(0deg);
		}
		50% {
			stroke-dasharray: 21.99px 21.99px;
			transform: rotate(450deg);
		}
		100% {
			stroke-dasharray: 0.01px 43.97px;
			transform: rotate(1080deg);
		}
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code progress ring class.
 *
 * @public
 */
class ProgressRing extends BaseProgress {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// This will override any usage of the paused attribute
		// inherited by the FAST Foundation BaseProgress component
		// so that VSCodeProgressRing can never be paused
		if (this.paused) {
			this.paused = false
		}
		// Defines a default aria label that screen readers can access
		this.setAttribute("aria-label", "Loading")
		this.setAttribute("aria-live", "assertive")
		this.setAttribute("role", "alert")
	}
	/**
	 * Component lifecycle method that runs when an attribute of the
	 * element is changed.
	 *
	 * @param attrName - The attribute that was changed
	 * @param oldVal - The old value of the attribute
	 * @param newVal - The new value of the attribute
	 *
	 * @internal
	 */
	attributeChangedCallback(attrName, oldVal, newVal) {
		if (attrName === "value") {
			// This will override any usage of the value attribute
			// inherited by the FAST Foundation BaseProgress component
			// so that VSCodeProgressRing can never set to be a
			// determinate state
			this.removeAttribute("value")
		}
	}
}
/**
 * The Visual Studio Code progress ring component registration.
 *
 * @remarks
 * HTML Element: `<vscode-progress-ring>`
 *
 * @public
 */
const vsCodeProgressRing = ProgressRing.compose({
	baseName: "progress-ring",
	template: progressRingTemplate,
	styles: progressRingStyles,
	indeterminateIndicator: `
		<svg class="progress" part="progress" viewBox="0 0 16 16">
			<circle
				class="background"
				part="background"
				cx="8px"
				cy="8px"
				r="7px"
			></circle>
			<circle
				class="indeterminate-indicator-1"
				part="indeterminate-indicator-1"
				cx="8px"
				cy="8px"
				r="7px"
			></circle>
		</svg>
	`,
})

// Copyright (c) Microsoft Corporation.
const radioGroupStyles = (context, definition) => css`
	${display("flex")} :host {
		align-items: flex-start;
		margin: calc(${designUnit} * 1px) 0;
		flex-direction: column;
	}
	.positioning-region {
		display: flex;
		flex-wrap: wrap;
	}
	:host([orientation="vertical"]) .positioning-region {
		flex-direction: column;
	}
	:host([orientation="horizontal"]) .positioning-region {
		flex-direction: row;
	}
	::slotted([slot="label"]) {
		color: ${foreground};
		font-size: ${typeRampBaseFontSize};
		margin: calc(${designUnit} * 1px) 0;
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code radio group class.
 *
 * @public
 */
class RadioGroup extends RadioGroup$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// Generates a unique id for each radio group label so that the label element
		// within the group can be correctly associated with the radio group.
		const label = this.querySelector("label")
		if (label) {
			const id = "radio-group-" + Math.random().toString(16).slice(2)
			label.setAttribute("id", id)
			this.setAttribute("aria-labelledby", id)
		}
	}
}
/**
 * The Visual Studio Code radio group component registration.
 *
 * @remarks
 * HTML Element: `<vscode-radio-group>`
 *
 * @public
 */
const vsCodeRadioGroup = RadioGroup.compose({
	baseName: "radio-group",
	template: radioGroupTemplate,
	styles: radioGroupStyles,
})

// Copyright (c) Microsoft Corporation.
const radioStyles = (context, definition) => css`
	${display("inline-flex")} :host {
		align-items: center;
		flex-direction: row;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		margin: calc(${designUnit} * 1px) 0;
		outline: none;
		position: relative;
		transition: all 0.2s ease-in-out;
		user-select: none;
	}
	.control {
		background: ${checkboxBackground};
		border-radius: 999px;
		border: calc(${borderWidth} * 1px) solid ${checkboxBorder};
		box-sizing: border-box;
		cursor: pointer;
		height: calc(${designUnit} * 4px);
		position: relative;
		outline: none;
		width: calc(${designUnit} * 4px);
	}
	.label {
		color: ${foreground};
		cursor: pointer;
		font-family: ${fontFamily};
		margin-inline-end: calc(${designUnit} * 2px + 2px);
		padding-inline-start: calc(${designUnit} * 2px + 2px);
	}
	.label__hidden {
		display: none;
		visibility: hidden;
	}
	.control,
	.checked-indicator {
		flex-shrink: 0;
	}
	.checked-indicator {
		background: ${foreground};
		border-radius: 999px;
		display: inline-block;
		inset: calc(${designUnit} * 1px);
		opacity: 0;
		pointer-events: none;
		position: absolute;
	}
	:host(:not([disabled])) .control:hover {
		background: ${checkboxBackground};
		border-color: ${checkboxBorder};
	}
	:host(:not([disabled])) .control:active {
		background: ${checkboxBackground};
		border-color: ${focusBorder};
	}
	:host(:${focusVisible}) .control {
		border: calc(${borderWidth} * 1px) solid ${focusBorder};
	}
	:host([aria-checked="true"]) .control {
		background: ${checkboxBackground};
		border: calc(${borderWidth} * 1px) solid ${checkboxBorder};
	}
	:host([aria-checked="true"]:not([disabled])) .control:hover {
		background: ${checkboxBackground};
		border: calc(${borderWidth} * 1px) solid ${checkboxBorder};
	}
	:host([aria-checked="true"]:not([disabled])) .control:active {
		background: ${checkboxBackground};
		border: calc(${borderWidth} * 1px) solid ${focusBorder};
	}
	:host([aria-checked="true"]:${focusVisible}:not([disabled])) .control {
		border: calc(${borderWidth} * 1px) solid ${focusBorder};
	}
	:host([disabled]) .label,
	:host([readonly]) .label,
	:host([readonly]) .control,
	:host([disabled]) .control {
		cursor: ${disabledCursor};
	}
	:host([aria-checked="true"]) .checked-indicator {
		opacity: 1;
	}
	:host([disabled]) {
		opacity: ${disabledOpacity};
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code radio class.
 *
 * @public
 */
class Radio extends Radio$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		if (this.textContent) {
			this.setAttribute("aria-label", this.textContent)
		} else {
			// Fallback to the label if there is no text content
			this.setAttribute("aria-label", "Radio")
		}
	}
}
/**
 * The Visual Studio Code radio component registration.
 *
 * @remarks
 * HTML Element: `<vscode-radio>`
 *
 * @public
 */
const vsCodeRadio = Radio.compose({
	baseName: "radio",
	template: radioTemplate,
	styles: radioStyles,
	checkedIndicator: `
		<div part="checked-indicator" class="checked-indicator"></div>
	`,
})

// Copyright (c) Microsoft Corporation.
const tagStyles = (context, definition) => css`
	${display("inline-block")} :host {
		box-sizing: border-box;
		font-family: ${fontFamily};
		font-size: ${typeRampMinus1FontSize};
		line-height: ${typeRampMinus1LineHeight};
	}
	.control {
		background-color: ${badgeBackground};
		border: calc(${borderWidth} * 1px) solid ${buttonBorder};
		border-radius: ${tagCornerRadius};
		color: ${badgeForeground};
		padding: calc(${designUnit} * 0.5px) calc(${designUnit} * 1px);
		text-transform: uppercase;
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code tag class.
 *
 * @public
 */
class Tag extends Badge$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		// This will override any usage of the circular attribute
		// inherited by the FAST Foundation Badge component so that
		// VSCodeTags are never circular
		if (this.circular) {
			this.circular = false
		}
	}
}
/**
 * The Visual Studio Code tag component registration.
 *
 * @remarks
 * HTML Element: `<vscode-tag>`
 *
 * @public
 */
const vsCodeTag = Tag.compose({
	baseName: "tag",
	template: badgeTemplate,
	styles: tagStyles,
})

// Copyright (c) Microsoft Corporation.
const textAreaStyles = (context, definition) => css`
	${display("inline-block")} :host {
		font-family: ${fontFamily};
		outline: none;
		user-select: none;
	}
	.control {
		box-sizing: border-box;
		position: relative;
		color: ${inputForeground};
		background: ${inputBackground};
		border-radius: calc(${cornerRadiusRound} * 1px);
		border: calc(${borderWidth} * 1px) solid ${dropdownBorder};
		font: inherit;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		padding: calc(${designUnit} * 2px + 1px);
		width: 100%;
		min-width: ${inputMinWidth};
		resize: none;
	}
	.control:hover:enabled {
		background: ${inputBackground};
		border-color: ${dropdownBorder};
	}
	.control:active:enabled {
		background: ${inputBackground};
		border-color: ${focusBorder};
	}
	.control:hover,	.control:${focusVisible},	.control:disabled,	.control:active {
		outline: none;
	}
	.control::-webkit-scrollbar {
		width: ${scrollbarWidth};
		height: ${scrollbarHeight};
	}
	.control::-webkit-scrollbar-corner {
		background: ${inputBackground};
	}
	.control::-webkit-scrollbar-thumb {
		background: ${scrollbarSliderBackground};
	}
	.control::-webkit-scrollbar-thumb:hover {
		background: ${scrollbarSliderHoverBackground};
	}
	.control::-webkit-scrollbar-thumb:active {
		background: ${scrollbarSliderActiveBackground};
	}
	:host(:focus-within:not([disabled])) .control {
		border-color: ${focusBorder};
	}
	:host([resize="both"]) .control {
		resize: both;
	}
	:host([resize="horizontal"]) .control {
		resize: horizontal;
	}
	:host([resize="vertical"]) .control {
		resize: vertical;
	}
	.label {
		display: block;
		color: ${foreground};
		cursor: pointer;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		margin-bottom: 2px;
	}
	.label__hidden {
		display: none;
		visibility: hidden;
	}
	:host([disabled]) .label,
	:host([readonly]) .label,
	:host([readonly]) .control,
	:host([disabled]) .control {
		cursor: ${disabledCursor};
	}
	:host([disabled]) {
		opacity: ${disabledOpacity};
	}
	:host([disabled]) .control {
		border-color: ${dropdownBorder};
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code text area class.
 *
 * @remarks
 * HTML Element: `<vscode-text-area>`
 *
 * @public
 */
class TextArea extends TextArea$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		if (this.textContent) {
			this.setAttribute("aria-label", this.textContent)
		} else {
			// Describe the generic component if no label is provided
			this.setAttribute("aria-label", "Text area")
		}
	}
}
/**
 * The Visual Studio Code text area component registration.
 *
 * @remarks
 * HTML Element: `<vscode-text-area>`
 *
 * @public
 */
const vsCodeTextArea = TextArea.compose({
	baseName: "text-area",
	template: textAreaTemplate,
	styles: textAreaStyles,
	shadowOptions: {
		delegatesFocus: true,
	},
})

// Copyright (c) Microsoft Corporation.
const textFieldStyles = (context, definition) => css`
	${display("inline-block")} :host {
		font-family: ${fontFamily};
		outline: none;
		user-select: none;
	}
	.root {
		box-sizing: border-box;
		position: relative;
		display: flex;
		flex-direction: row;
		color: ${inputForeground};
		background: ${inputBackground};
		border-radius: calc(${cornerRadiusRound} * 1px);
		border: calc(${borderWidth} * 1px) solid ${dropdownBorder};
		height: calc(${inputHeight} * 1px);
		min-width: ${inputMinWidth};
	}
	.control {
		-webkit-appearance: none;
		font: inherit;
		background: transparent;
		border: 0;
		color: inherit;
		height: calc(100% - (${designUnit} * 1px));
		width: 100%;
		margin-top: auto;
		margin-bottom: auto;
		border: none;
		padding: 0 calc(${designUnit} * 2px + 1px);
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
	}
	.control:hover,	.control:${focusVisible},	.control:disabled,	.control:active {
		outline: none;
	}
	.label {
		display: block;
		color: ${foreground};
		cursor: pointer;
		font-size: ${typeRampBaseFontSize};
		line-height: ${typeRampBaseLineHeight};
		margin-bottom: 2px;
	}
	.label__hidden {
		display: none;
		visibility: hidden;
	}
	.start,
	.end {
		display: flex;
		margin: auto;
		fill: currentcolor;
	}
	::slotted(svg),
	::slotted(span) {
		width: calc(${designUnit} * 4px);
		height: calc(${designUnit} * 4px);
	}
	.start {
		margin-inline-start: calc(${designUnit} * 2px);
	}
	.end {
		margin-inline-end: calc(${designUnit} * 2px);
	}
	:host(:hover:not([disabled])) .root {
		background: ${inputBackground};
		border-color: ${dropdownBorder};
	}
	:host(:active:not([disabled])) .root {
		background: ${inputBackground};
		border-color: ${focusBorder};
	}
	:host(:focus-within:not([disabled])) .root {
		border-color: ${focusBorder};
	}
	:host([disabled]) .label,
	:host([readonly]) .label,
	:host([readonly]) .control,
	:host([disabled]) .control {
		cursor: ${disabledCursor};
	}
	:host([disabled]) {
		opacity: ${disabledOpacity};
	}
	:host([disabled]) .control {
		border-color: ${dropdownBorder};
	}
`

// Copyright (c) Microsoft Corporation.
/**
 * The Visual Studio Code text field class.
 *
 * @public
 */
class TextField extends TextField$1 {
	/**
	 * Component lifecycle method that runs when the component is inserted
	 * into the DOM.
	 *
	 * @internal
	 */
	connectedCallback() {
		super.connectedCallback()
		if (this.textContent) {
			this.setAttribute("aria-label", this.textContent)
		} else {
			// Describe the generic component if no label is provided
			this.setAttribute("aria-label", "Text field")
		}
	}
}
/**
 * The Visual Studio Code text field component registration.
 *
 * @remarks
 * HTML Element: `<vscode-text-field>`
 *
 * @public
 */
const vsCodeTextField = TextField.compose({
	baseName: "text-field",
	template: textFieldTemplate,
	styles: textFieldStyles,
	shadowOptions: {
		delegatesFocus: true,
	},
})

/**
 * All VSCode Web Components
 * @public
 * @remarks
 * This object can be passed directly to the Design System's `register` method to
 * statically link and register all available components.
 */
const allComponents = {
	vsCodeBadge,
	vsCodeButton,
	vsCodeCheckbox,
	vsCodeDataGrid,
	vsCodeDataGridCell,
	vsCodeDataGridRow,
	vsCodeDivider,
	vsCodeDropdown,
	vsCodeLink,
	vsCodeOption,
	vsCodePanels,
	vsCodePanelTab,
	vsCodePanelView,
	vsCodeProgressRing,
	vsCodeRadioGroup,
	vsCodeRadio,
	vsCodeTag,
	vsCodeTextArea,
	vsCodeTextField,
	register(container, ...rest) {
		if (!container) {
			// preserve backward compatibility with code that loops through
			// the values of this object and calls them as funcs with no args
			return
		}
		for (const key in this) {
			if (key === "register") {
				continue
			}
			this[key]().register(container, ...rest)
		}
	},
}

// Copyright (c) Microsoft Corporation.
/**
 * Provides a design system for the specified element either by returning one that was
 * already created for that element or creating one.
 * @param element - The element to root the design system at. By default, this is the body.
 * @returns A VSCode Design System
 * @public
 */
function provideVSCodeDesignSystem(element) {
	return DesignSystem.getOrCreate(element).withPrefix("vscode")
}

// Copyright (c) Microsoft Corporation.
/**
 * The global VSCode Design System.
 * @remarks
 * Only available if the components are added through a script tag
 * rather than a module/build system.
 */
const VSCodeDesignSystem = provideVSCodeDesignSystem().register(allComponents)

export {
	Badge,
	Button,
	Checkbox,
	DataGrid,
	DataGridCell,
	DataGridCellTypes,
	DataGridRow,
	DataGridRowTypes,
	Divider,
	DividerRole,
	Dropdown,
	SelectPosition as DropdownPosition,
	GenerateHeaderOptions,
	Link,
	Option$1 as Option,
	PanelTab,
	PanelView,
	Panels,
	ProgressRing,
	Radio,
	RadioGroup,
	Orientation as RadioGroupOrientation,
	Tag,
	TextArea,
	TextAreaResize,
	TextField,
	TextFieldType,
	VSCodeDesignSystem,
	allComponents,
	provideVSCodeDesignSystem,
	vsCodeBadge,
	vsCodeButton,
	vsCodeCheckbox,
	vsCodeDataGrid,
	vsCodeDataGridCell,
	vsCodeDataGridRow,
	vsCodeDivider,
	vsCodeDropdown,
	vsCodeLink,
	vsCodeOption,
	vsCodePanelTab,
	vsCodePanelView,
	vsCodePanels,
	vsCodeProgressRing,
	vsCodeRadio,
	vsCodeRadioGroup,
	vsCodeTag,
	vsCodeTextArea,
	vsCodeTextField,
}
