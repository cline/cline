/*
 * Cline Device: browser client for the device bridge.
 *
 * Speaks the same protocol as the ESP32 firmware (see ../README.md and
 * ../../../sdk/packages/device/src/protocol.ts): JSON text frames plus binary audio frames of
 * [u16 LE sequence][1024 x s16le mono @ 16 kHz]. No build step, no
 * dependencies, so the folder can be wrapped as a Tauri / Android WebView app
 * as-is. Point a wrapped copy at a bridge with ?bridge=wss://host:25471.
 */
(() => {
	const SAMPLE_RATE = 16000;
	const FRAME_SAMPLES = 1024;
	const MIN_PTT_MS = 300;
	const WANDER_MS = 2400;
	const WELCOME_TEXT =
		"Hold to talk. Start with “cloud session” to run your task in the cloud.";
	const STORE = {
		token: "clineDevice.token",
		bridge: "clineDevice.bridge",
		avatar: "clineDevice.avatar",
	};

	const LABELS = {
		idle: "",
		working: "WORKING",
		waiting: "NEEDS YOU",
		listening: "LISTENING",
		thinking: "THINKING",
		done: "DONE!",
		error: "OOPS",
		offline: "OFFLINE",
	};

	const $ = (id) => document.getElementById(id);
	const el = {
		app: $("app"),
		info: $("info"),
		label: $("label"),
		counters: $("counters"),
		menuWrap: $("menu-wrap"),
		menuButton: $("menu-button"),
		menu: $("menu"),
		menuNew: $("menu-new"),
		menuUnpair: $("menu-unpair"),
		avatar: $("avatar"),
		sprite: $("sprite"),
		bubble: $("bubble"),
		speech: $("speech"),
		speechKind: $("speech-kind"),
		speechText: $("speech-text"),
		bridgeHelp: $("bridge-help"),
		sessionActions: $("session-actions"),
		newSession: $("new-session"),
		stopSession: $("stop-session"),
		text: $("text"),
		pair: $("pair"),
		code: $("code"),
		approval: $("approval"),
		approve: $("approve"),
		deny: $("deny"),
		confirm: $("confirm"),
		voiceCancel: $("voice-cancel"),
		voiceSend: $("voice-send"),
		countdown: $("countdown"),
		talk: $("talk"),
		mic: $("mic"),
		micLabel: $("mic-label"),
		newOff: $("new-off"),
		status: $("status"),
	};

	// ---- Storage (may be unavailable in private modes) ---------------------
	const store = {
		get(key) {
			try {
				return localStorage.getItem(key);
			} catch {
				return null;
			}
		},
		set(key, value) {
			try {
				if (value == null) localStorage.removeItem(key);
				else localStorage.setItem(key, value);
			} catch {
				/* ignore */
			}
		},
	};

	// ---- View model ---------------------------------------------------------
	const view = {
		link: "connecting", // connecting | pairing | online | offline
		device: { state: "offline", approval: null },
		answered: null, // approval id we already responded to
		notice: null, // { text }, replaced by the next visible activity
		pending: null, // { text, target, until }
		recording: null, // { newTask }
		activity: null,
		armNew: false, // menu → New session: next recording starts a new task
		stats: null,
		wander: 0,
	};

	// ---- Device sprites ----------------------------------------------------------
	let avatarStates = {};

	async function loadAvatar() {
		try {
			const res = await fetch("avatars/manifest.json", { cache: "no-cache" });
			if (!res.ok) throw new Error("Avatar manifest unavailable");
			const manifest = await res.json();
			if (manifest.schemaVersion !== 1)
				throw new Error("Unsupported avatar schema");
			const requested =
				new URLSearchParams(location.search).get("avatar") ??
				store.get(STORE.avatar);
			const avatar =
				manifest.avatars[requested] ?? manifest.avatars[manifest.defaultAvatar];
			const variant = avatar.variants[manifest.devices.browser.variant];
			if (!variant || !["gif", "png", "webp"].includes(variant.format))
				throw new Error("Avatar has no browser image variant");
			avatarStates = variant.states;
		} catch (error) {
			console.error("Unable to load avatar", error);
			avatarStates = {};
		}
		render();
	}

	function spriteFor(state) {
		const frames = avatarStates[state] ?? avatarStates.idle;
		return frames?.length
			? `avatars/${frames[view.wander % frames.length]}`
			: null;
	}

	// ---- Bridge connection ----------------------------------------------------
	let ws = null;
	let retryMs = 1000;
	let retryTimer = null;

	function bridgeUrl() {
		const param = new URLSearchParams(location.search).get("bridge");
		if (param) store.set(STORE.bridge, param);
		const saved = param ?? store.get(STORE.bridge);
		if (saved)
			return `${saved.replace(/\/+$/, "").replace(/\/device$/, "")}/device`;
		const scheme = location.protocol === "https:" ? "wss:" : "ws:";
		return `${scheme}//${location.host}/device`;
	}

	function connect() {
		clearTimeout(retryTimer);
		view.link = "connecting";
		render();
		const socket = new WebSocket(bridgeUrl());
		socket.binaryType = "arraybuffer";
		ws = socket;
		socket.onopen = () => {
			retryMs = 1000;
			const token = store.get(STORE.token);
			if (token) send({ t: "hello", token, fw: "web-0.1.0" });
			else {
				view.link = "pairing";
				render();
				el.code.focus();
			}
		};
		socket.onmessage = (event) => {
			if (typeof event.data !== "string") return;
			let msg;
			try {
				msg = JSON.parse(event.data);
			} catch {
				return;
			}
			handle(msg);
		};
		socket.onclose = () => {
			if (ws !== socket) return;
			ws = null;
			stopRecording(true);
			view.link = "offline"; // reconnect re-enters pairing if still unpaired
			view.device = { state: "offline", approval: null };
			render();
			retryTimer = setTimeout(connect, retryMs);
			retryMs = Math.min(retryMs * 2, 10000);
		};
	}

	function send(msg) {
		if (ws?.readyState !== WebSocket.OPEN) return false;
		ws.send(JSON.stringify(msg));
		return true;
	}

	function handle(msg) {
		switch (msg.t) {
			case "paired":
				store.set(STORE.token, msg.token);
				break;
			case "welcome":
				view.link = "online";
				send({ t: "stats" });
				break;
			case "auth_error":
				store.set(STORE.token, null);
				view.link = "pairing";
				notice(
					msg.reason === "bad_code"
						? "That code didn't work. Get a fresh one with --pair."
						: "Pair this device to continue.",
				);
				break;
			case "state":
				view.device = msg;
				if (msg.activity) {
					if (
						!view.activity ||
						view.activity.kind !== msg.activity.kind ||
						view.activity.text !== msg.activity.text
					)
						view.notice = null;
					view.activity = msg.activity;
				}
				if (msg.state !== "waiting") view.answered = null;
				if (msg.state !== "thinking") view.pending = null;
				break;
			case "voice":
				onVoice(msg);
				break;
			case "stats":
				view.stats = msg;
				break;
			case "error":
				notice(msg.reason);
				break;
		}
		render();
	}

	function onVoice(msg) {
		switch (msg.status) {
			case "transcribed": {
				const ms = msg.cancel_ms || 3000;
				view.pending = {
					text: msg.text ?? "",
					target: msg.target,
					until: Date.now() + ms,
				};
				tickCountdown();
				break;
			}
			case "starting":
				view.pending = null;
				notice("Starting cloud session…");
				break;
			case "submitted":
				view.pending = null;
				notice(
					msg.target === "cloud"
						? "Started a cloud session"
						: msg.target === "new"
							? "Started a new task"
							: "Sent to the current task",
				);
				break;
			case "cancelled":
				view.pending = null;
				break;
			case "error":
				view.pending = null;
				notice(`Voice: ${msg.text ?? "failed"}`);
				break;
		}
	}

	function notice(text) {
		view.notice = { text };
	}

	function tickCountdown() {
		if (!view.pending) return;
		render();
		if (view.pending.until > Date.now()) setTimeout(tickCountdown, 250);
	}

	// ---- Rendering ----------------------------------------------------------
	function displayState() {
		if (view.link !== "online") return "offline";
		if (view.recording) return "listening";
		if (view.armNew) return "idle";
		return view.device.state ?? "idle";
	}

	function render() {
		const now = Date.now();
		const state = displayState();
		const device = view.device;
		const welcome =
			view.link === "online" &&
			state === "idle" &&
			!view.pending &&
			(view.armNew || (!view.activity && !view.notice));
		el.app.dataset.state = state;

		el.label.textContent =
			view.link === "pairing"
				? "PAIR"
				: view.link === "connecting"
					? "CONNECTING"
					: (LABELS[state] ?? state.toUpperCase());
		el.counters.innerHTML =
			view.link === "online" && view.stats
				? `<b>${Number(view.stats.sessions)}</b> active · <b>${Number(view.stats.today)}</b> today`
				: "";

		const src = spriteFor(state);
		el.sprite.hidden = !src;
		if (src && el.sprite.getAttribute("src") !== src)
			el.sprite.setAttribute("src", src);
		el.bubble.hidden = state !== "waiting";

		// Body text: notice > pending transcript > state-specific detail.
		const activity = welcome
			? { kind: "status", text: WELCOME_TEXT }
			: view.notice
				? { kind: "status", text: view.notice.text }
				: view.activity;
		el.speech.hidden =
			!activity || view.link !== "online" || state === "offline";
		el.speechKind.textContent =
			activity?.kind === "tool"
				? "TOOL CALL"
				: activity?.kind === "thinking"
					? "THINKING"
					: activity?.kind === "text"
						? "CLINE"
						: "STATUS";
		el.speechText.textContent = activity?.text ?? "";
		el.speech.dataset.kind = activity?.kind ?? "status";
		el.text.textContent = bodyText(state, device);
		el.label.hidden = !el.label.textContent;
		el.text.hidden = !el.text.textContent;
		el.info.hidden = el.label.hidden && el.text.hidden;

		// Controls.
		const showPair = view.link === "pairing";
		el.pair.hidden = !showPair;
		const showApproval =
			state === "waiting" &&
			device.approval &&
			device.approval.id !== view.answered;
		el.approval.hidden = !showApproval;
		el.confirm.hidden = !view.pending;
		if (view.pending) {
			const left = Math.max(0, Math.ceil((view.pending.until - now) / 1000));
			el.countdown.textContent = left ? `(${left})` : "";
		}
		// Talking and the menu only make sense while paired and connected.
		const online = view.link === "online";
		if (!online) {
			view.armNew = false;
			setMenu(false);
		}
		el.menuWrap.hidden = !online;
		el.sessionActions.hidden = !online || state === "offline" || welcome;
		el.menuNew.hidden = welcome;
		el.stopSession.hidden =
			!device.session || !["working", "waiting"].includes(device.state);
		el.newSession.disabled = !!view.recording;
		el.bridgeHelp.hidden = state !== "offline" || view.link === "pairing";
		el.counters.hidden = view.link !== "online";
		el.talk.hidden = !online || showApproval || !!view.pending;
		const canTalk = view.link === "online";
		el.mic.disabled = !canTalk && !view.recording;
		el.mic.classList.toggle("recording", !!view.recording);
		el.mic.classList.toggle("armed", view.armNew && !view.recording);
		el.micLabel.textContent = view.recording
			? "Release to send"
			: view.armNew
				? "Hold to talk · new session"
				: "Hold to talk";
		el.newOff.hidden = !view.armNew || !!view.recording || welcome;

		el.menuNew.disabled = !canTalk;
		el.menuUnpair.disabled = !store.get(STORE.token);
		const status =
			view.link === "offline" ? "Bridge unreachable, retrying…" : "";
		el.status.textContent = status;
		el.status.hidden = !status;
	}

	function bodyText(state, device) {
		if (view.pending) {
			return `${view.pending.target === "cloud" ? "Cloud session" : view.pending.target === "new" ? "New task" : "Follow-up"}: “${view.pending.text}”`;
		}
		if (view.link === "pairing")
			return view.notice?.text ?? "Enter the 6-digit code from the bridge.";
		if (view.link === "connecting") return "Connecting to the bridge…";
		if (view.link === "offline")
			return "Start the bridge, then open its HTTPS address. This page will reconnect automatically.";
		switch (state) {
			case "waiting":
				return device.approval?.summary ?? "Approval needed";
			case "listening":
				return view.recording?.newTask
					? "New task: release to send"
					: "Listening… release to send";
			case "thinking":
				return device.transcript ? `“${device.transcript}”` : "Thinking…";
			case "done":
				return device.reply ?? "Task complete";
			case "error":
				return device.err ?? "Something failed";
			case "working":
				return view.armNew
					? "Hold to talk to start a new session"
					: "Hold to talk to send a follow-up";
			default:
				return "";
		}
	}

	// ---- Audio capture ------------------------------------------------------
	// An AudioWorklet hands 128-sample blocks to the main thread, which
	// resamples to 16 kHz, packs s16le and ships 1024-sample frames.
	const WORKLET = `
		class Tap extends AudioWorkletProcessor {
			process(inputs) {
				const ch = inputs[0] && inputs[0][0];
				if (ch) this.port.postMessage(ch.slice(0));
				return true;
			}
		}
		registerProcessor("tap", Tap);`;

	let audio = null; // { ctx, stream, node, source }
	let seq = 0;
	const frame = new Int16Array(FRAME_SAMPLES);
	let frameFill = 0;
	let resampleState = { pos: 0, prev: 0 };
	let recordStart = 0;
	let pressToken = 0;

	function resampleTo16k(input, inputRate) {
		if (inputRate === SAMPLE_RATE) return input;
		const step = inputRate / SAMPLE_RATE;
		const out = [];
		let { pos, prev } = resampleState;
		// Position is relative to a virtual buffer [prev, ...input].
		while (pos < input.length) {
			const i = Math.floor(pos);
			const frac = pos - i;
			const left = i === 0 ? prev : input[i - 1];
			const right = input[i];
			out.push(left + (right - left) * frac);
			pos += step;
		}
		resampleState = { pos: pos - input.length, prev: input[input.length - 1] };
		return Float32Array.from(out);
	}

	function pushSamples(samples) {
		for (let i = 0; i < samples.length; i++) {
			const s = Math.max(-1, Math.min(1, samples[i]));
			frame[frameFill++] = s < 0 ? s * 0x8000 : s * 0x7fff;
			if (frameFill === FRAME_SAMPLES) flushFrame();
		}
	}

	function flushFrame() {
		if (frameFill === 0) return;
		const bytes = new Uint8Array(2 + frameFill * 2);
		const dv = new DataView(bytes.buffer);
		dv.setUint16(0, seq & 0xffff, true);
		for (let i = 0; i < frameFill; i++) dv.setInt16(2 + i * 2, frame[i], true);
		if (ws?.readyState === WebSocket.OPEN) ws.send(bytes);
		seq = (seq + 1) & 0xffff;
		frameFill = 0;
	}

	async function openMic() {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
		});
		let ctx;
		try {
			ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
		} catch {
			ctx = new AudioContext(); // some browsers refuse custom rates; we resample
		}
		const url = URL.createObjectURL(
			new Blob([WORKLET], { type: "text/javascript" }),
		);
		try {
			await ctx.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		const source = ctx.createMediaStreamSource(stream);
		const node = new AudioWorkletNode(ctx, "tap");
		node.port.onmessage = (e) => {
			if (view.recording) pushSamples(resampleTo16k(e.data, ctx.sampleRate));
		};
		source.connect(node);
		await ctx.resume();
		return { ctx, stream, node, source };
	}

	function closeMic() {
		if (!audio) return;
		const { ctx, stream, node, source } = audio;
		audio = null;
		node.port.onmessage = null;
		source.disconnect();
		node.disconnect();
		for (const track of stream.getTracks()) track.stop(); // mic indicator off
		void ctx.close();
	}

	async function startRecording(newTask) {
		if (view.recording || view.link !== "online") return;
		const token = ++pressToken;
		view.recording = { newTask };
		render();
		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			view.recording = null;
			notice(
				"The mic needs HTTPS. Open the https:// address the bridge printed.",
			);
			render();
			return;
		}
		try {
			audio = await openMic();
		} catch (error) {
			view.recording = null;
			notice(
				error?.name === "NotAllowedError"
					? "Microphone permission was denied."
					: `Mic error: ${error?.message ?? error}`,
			);
			render();
			return;
		}
		if (token !== pressToken || !view.recording) {
			closeMic(); // released before the mic was ready
			return;
		}
		seq = 0;
		frameFill = 0;
		resampleState = { pos: 0, prev: 0 };
		recordStart = Date.now();
		view.armNew = false; // "New session" applies to one recording
		send({
			t: "voice_start",
			rate: SAMPLE_RATE,
			bits: 16,
			ch: 1,
			...(newTask ? { target: "new" } : {}),
		});
	}

	function stopRecording(cancel) {
		if (!view.recording) return;
		const started = recordStart;
		view.recording = null;
		pressToken++;
		if (audio) {
			flushFrame();
			closeMic();
			const tooShort = Date.now() - started < MIN_PTT_MS;
			send({ t: cancel || tooShort ? "voice_cancel" : "voice_end" });
		}
		render();
	}

	// ---- Input ----------------------------------------------------------------
	function holdButton(button) {
		const down = (e) => {
			e.preventDefault();
			button.setPointerCapture?.(e.pointerId);
			void startRecording(view.armNew);
		};
		const up = () => stopRecording(false);
		button.addEventListener("pointerdown", down);
		button.addEventListener("pointerup", up);
		button.addEventListener("pointercancel", () => stopRecording(true));
		button.addEventListener("contextmenu", (e) => e.preventDefault());
	}
	holdButton(el.mic);

	// Keyboard push-to-talk on desktop: hold Space (Shift+Space = new task).
	let spaceHeld = false;
	addEventListener("keydown", (e) => {
		if (e.code !== "Space" || e.repeat || document.activeElement === el.code)
			return;
		e.preventDefault();
		spaceHeld = true;
		void startRecording(e.shiftKey || view.armNew);
	});
	addEventListener("keyup", (e) => {
		if (e.code !== "Space" || !spaceHeld) return;
		spaceHeld = false;
		stopRecording(false);
	});

	el.approve.addEventListener("click", () => answer(true));
	el.deny.addEventListener("click", () => answer(false));
	function answer(approved) {
		const id = view.device.approval?.id;
		if (!id || !send({ t: approved ? "approve" : "deny", id })) return;
		view.answered = id;
		notice(approved ? "Approved" : "Denied");
		render();
	}

	el.voiceCancel.addEventListener("click", () => {
		send({ t: "voice_cancel" });
		view.pending = null;
		render();
	});
	el.voiceSend.addEventListener("click", () => send({ t: "voice_confirm" }));

	// Session actions are visible; the device remains a shortcut to refresh stats.
	el.avatar.addEventListener("click", () => send({ t: "stats" }));
	el.stopSession.addEventListener("click", () => {
		if (send({ t: "abort" })) notice("Stopping…");
		render();
	});
	function newSession() {
		setMenu(false);
		view.armNew = true;
		view.activity = null;
		if (view.pending) send({ t: "voice_cancel" });
		view.pending = null;
		notice(WELCOME_TEXT);
		render();
	}
	el.newSession.addEventListener("click", newSession);

	el.pair.addEventListener("submit", (e) => {
		e.preventDefault();
		const code = el.code.value.trim();
		if (!/^\d{6}$/.test(code)) return;
		if (ws?.readyState === WebSocket.OPEN)
			send({ t: "pair", code, name: deviceName() });
		else connect();
		el.code.value = "";
	});

	// ---- Menu (upper right): New session, Unpair --------------------------
	function setMenu(open) {
		el.menu.hidden = !open;
		el.menuButton.setAttribute("aria-expanded", String(open));
	}
	el.menuButton.addEventListener("click", (e) => {
		e.stopPropagation();
		setMenu(el.menu.hidden);
	});
	document.addEventListener("pointerdown", (e) => {
		if (!el.menu.hidden && !e.target.closest(".menu-wrap")) setMenu(false);
	});
	addEventListener("keydown", (e) => {
		if (e.key === "Escape") setMenu(false);
	});

	el.menuNew.addEventListener("click", newSession);
	el.newOff.addEventListener("click", () => {
		view.armNew = false;
		render();
	});

	el.menuUnpair.addEventListener("click", () => {
		setMenu(false);
		if (!confirm("Unpair this device? You'll need a new pairing code.")) return;
		store.set(STORE.token, null);
		view.armNew = false;
		view.link = "pairing";
		ws?.close();
		render();
	});

	function deviceName() {
		const ua = navigator.userAgent;
		const kind = /Android/i.test(ua)
			? "android"
			: /iPhone|iPad/i.test(ua)
				? "ios"
				: "browser";
		return `web-${kind}`;
	}

	// ---- Housekeeping -------------------------------------------------------
	// Wander between the working animations so the device moves around.
	setInterval(() => {
		if (displayState() !== "working") return;
		view.wander++;
		render();
	}, WANDER_MS);

	// Keep the screen on while visible, like a desk device should.
	let wakeLock = null;
	async function keepAwake() {
		try {
			if (
				document.visibilityState === "visible" &&
				"wakeLock" in navigator &&
				!wakeLock
			) {
				wakeLock = await navigator.wakeLock.request("screen");
				wakeLock.addEventListener("release", () => {
					wakeLock = null;
				});
			}
		} catch {
			/* not supported or denied */
		}
	}
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") stopRecording(true);
		void keepAwake();
	});

	void loadAvatar();
	void keepAwake();
	connect();
})();
