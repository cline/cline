package bot.cline.jetbrains.ui

import bot.cline.jetbrains.ClineBundle
import bot.cline.jetbrains.hub.HubConnectionState
import bot.cline.jetbrains.hub.HubEndpoint
import bot.cline.jetbrains.session.ClineSessionListener
import bot.cline.jetbrains.session.ClineSessionService
import bot.cline.jetbrains.session.SessionSummary
import bot.cline.jetbrains.settings.ClineSettings
import bot.cline.jetbrains.settings.ClineSettingsConfigurable
import bot.cline.jetbrains.settings.SessionMode
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.Key
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.HTMLEditorKitBuilder
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.update.MergingUpdateQueue
import com.intellij.util.ui.update.Update
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import javax.swing.AbstractAction
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JEditorPane
import javax.swing.JPanel
import javax.swing.KeyStroke
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities
import javax.swing.text.DefaultCaret

/**
 * The chat surface inside the Cline tool window: status header, scrolling
 * transcript, approval banner, prompt editor and send/stop controls.
 */
class ClineChatPanel(private val project: Project, parentDisposable: Disposable) : SimpleToolWindowPanel(true, true), Disposable {
	companion object {
		val KEY: Key<ClineChatPanel> = Key.create("bot.cline.jetbrains.chatPanel")
	}

	private val service = ClineSessionService.getInstance(project)
	private val settings = ClineSettings.getInstance()
	private val renderer = TranscriptRenderer { settings.showReasoning }

	private val statusLabel = JBLabel(ClineBundle.message("chat.status.disconnected"), AllIcons.General.Warning, JBLabel.LEFT)
	private val sessionLabel = JBLabel(ClineBundle.message("chat.noSession")).apply { foreground = UIUtil.getLabelDisabledForeground() }
	private val usageLabel = JBLabel("").apply { foreground = UIUtil.getLabelDisabledForeground() }

	private val transcriptPane = JEditorPane().apply {
		editorKit = HTMLEditorKitBuilder().withWordWrapViewFactory().build()
		isEditable = false
		background = UIUtil.getPanelBackground()
		border = JBUI.Borders.empty(4)
		(caret as? DefaultCaret)?.updatePolicy = DefaultCaret.NEVER_UPDATE
	}
	private val transcriptScroll = JBScrollPane(transcriptPane).apply {
		horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
		border = JBUI.Borders.customLineBottom(JBColor.border())
	}

	private val approvalLabel = JBLabel("")
	private val approveButton = JButton(ClineBundle.message("chat.approve"))
	private val rejectButton = JButton(ClineBundle.message("chat.reject"))
	private val approvalPanel = JBPanel<JBPanel<*>>(BorderLayout()).apply {
		border = BorderFactory.createCompoundBorder(
			JBUI.Borders.customLine(JBColor(0xC99A2E, 0xE4B043), 1),
			JBUI.Borders.empty(6, 8),
		)
		background = JBColor(0xFFF6DD, 0x3B3522)
		add(approvalLabel, BorderLayout.CENTER)
		add(JPanel(FlowLayout(FlowLayout.RIGHT, 4, 0)).apply {
			isOpaque = false
			add(rejectButton)
			add(approveButton)
		}, BorderLayout.EAST)
		isVisible = false
	}

	private val promptArea = JBTextArea(3, 20).apply {
		lineWrap = true
		wrapStyleWord = true
		emptyText.text = ClineBundle.message("chat.placeholder")
		border = JBUI.Borders.empty(6)
	}
	private val modeCombo = ComboBox(SessionMode.entries.toTypedArray()).apply {
		renderer = SimpleListCellRenderer.create("") { it.label }
		selectedItem = service.sessionMode
		toolTipText = "Act runs tools; Plan only talks."
	}
	private val sendButton = JButton(ClineBundle.message("chat.send"))

	private val renderQueue = MergingUpdateQueue("cline-transcript", 60, true, this, this)
	private val removeListener: () -> Unit
	@Volatile private var currentApprovalId: String? = null

	init {
		Disposer.register(parentDisposable, this)
		toolbar = buildToolbar()
		setContent(buildBody())
		wireActions()
		removeListener = service.addListener(object : ClineSessionListener {
			override fun onConnectionChanged(state: HubConnectionState, endpoint: HubEndpoint?, error: Throwable?) =
				onEdt { updateStatus(state, endpoint, error) }

			override fun onTranscriptChanged() = scheduleRender()

			override fun onSessionChanged(sessionId: String?, title: String?) = onEdt { updateSessionLabel(sessionId, title) }
		})
		updateStatus(service.connectionState, service.endpoint, service.connectionError)
		updateSessionLabel(service.sessionId, service.sessionTitle)
		scheduleRender()
		service.connect()
	}

	// ------------------------------------------------------------------ layout

	private fun buildToolbar(): JComponent {
		val group = DefaultActionGroup().apply {
			add(simpleAction(ClineBundle.message("chat.newSession"), AllIcons.General.Add) { service.newSession(); promptArea.requestFocusInWindow() })
			add(simpleAction(ClineBundle.message("chat.sessions"), AllIcons.Vcs.History) { showSessionPicker(it) })
			add(simpleAction(ClineBundle.message("chat.reconnect"), AllIcons.Actions.Refresh) { service.connect(force = true) })
			addSeparator()
			add(simpleAction(ClineBundle.message("chat.settings"), AllIcons.General.Settings) {
				ShowSettingsUtil.getInstance().showSettingsDialog(project, ClineSettingsConfigurable::class.java)
			})
		}
		val toolbar = ActionManager.getInstance().createActionToolbar("ClineChatToolbar", group, true)
		toolbar.targetComponent = this
		val header = JBPanel<JBPanel<*>>(BorderLayout()).apply {
			border = JBUI.Borders.customLineBottom(JBColor.border())
			add(JPanel(BorderLayout()).apply {
				isOpaque = false
				border = JBUI.Borders.empty(2, 8, 2, 0)
				add(statusLabel, BorderLayout.NORTH)
				add(sessionLabel, BorderLayout.SOUTH)
			}, BorderLayout.CENTER)
			add(toolbar.component, BorderLayout.EAST)
		}
		return header
	}

	private fun buildBody(): JComponent {
		val input = JBPanel<JBPanel<*>>(BorderLayout()).apply {
			border = JBUI.Borders.empty(6)
			add(JBScrollPane(promptArea).apply {
				border = JBUI.Borders.customLine(JBColor.border(), 1)
				minimumSize = Dimension(100, 60)
			}, BorderLayout.CENTER)
			add(JPanel(BorderLayout()).apply {
				isOpaque = false
				border = JBUI.Borders.emptyTop(6)
				add(JPanel(FlowLayout(FlowLayout.LEFT, 6, 0)).apply {
					isOpaque = false
					add(modeCombo)
					add(usageLabel)
				}, BorderLayout.WEST)
				add(sendButton, BorderLayout.EAST)
			}, BorderLayout.SOUTH)
		}
		val south = JBPanel<JBPanel<*>>(BorderLayout()).apply {
			add(approvalPanel, BorderLayout.NORTH)
			add(input, BorderLayout.CENTER)
		}
		return JBPanel<JBPanel<*>>(BorderLayout()).apply {
			add(transcriptScroll, BorderLayout.CENTER)
			add(south, BorderLayout.SOUTH)
		}
	}

	private fun simpleAction(text: String, icon: javax.swing.Icon, handler: (AnActionEvent) -> Unit): AnAction =
		object : AnAction(text, text, icon) {
			override fun actionPerformed(e: AnActionEvent) = handler(e)
			override fun getActionUpdateThread() = ActionUpdateThread.BGT
		}

	private fun wireActions() {
		sendButton.addActionListener { onSendOrStop() }
		val sendKey = KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, java.awt.Toolkit.getDefaultToolkit().menuShortcutKeyMaskEx)
		val ctrlEnter = KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, KeyEvent.CTRL_DOWN_MASK)
		for (stroke in setOf(sendKey, ctrlEnter)) {
			promptArea.inputMap.put(stroke, "cline.send")
		}
		promptArea.actionMap.put("cline.send", object : AbstractAction() {
			override fun actionPerformed(e: ActionEvent) = onSendOrStop()
		})
		modeCombo.addActionListener {
			(modeCombo.selectedItem as? SessionMode)?.let { service.sessionMode = it }
		}
		approveButton.addActionListener { currentApprovalId?.let { service.respondToApproval(it, approved = true) } }
		rejectButton.addActionListener { currentApprovalId?.let { service.respondToApproval(it, approved = false, reason = "Rejected from JetBrains IDE") } }
	}

	// ------------------------------------------------------------------ behaviour

	private fun onSendOrStop() {
		if (service.isRunning) {
			service.abort()
			return
		}
		val text = promptArea.text
		if (text.isBlank()) return
		promptArea.text = ""
		service.send(text, (modeCombo.selectedItem as? SessionMode) ?: SessionMode.ACT)
	}

	/** Used by the editor action to drop selected code into the prompt. */
	fun appendToPrompt(text: String) {
		val existing = promptArea.text
		promptArea.text = if (existing.isBlank()) text else existing.trimEnd() + "\n\n" + text
		promptArea.caretPosition = promptArea.document.length
		promptArea.requestFocusInWindow()
	}

	private fun showSessionPicker(e: AnActionEvent) {
		val component = e.inputEvent?.component as? JComponent ?: this
		service.listSessions().whenComplete { sessions, error ->
			onEdt {
				if (error != null) {
					sessionLabel.text = "Could not list sessions: ${error.cause?.message ?: error.message}"
					return@onEdt
				}
				val items = sessions.filter { it.workspaceRoot == null || it.workspaceRoot == project.basePath }
					.ifEmpty { sessions }
				if (items.isEmpty()) {
					sessionLabel.text = "No sessions on this hub yet."
					return@onEdt
				}
				JBPopupFactory.getInstance()
					.createPopupChooserBuilder(items)
					.setTitle(ClineBundle.message("chat.sessions"))
					.setRenderer(SimpleListCellRenderer.create<SessionSummary>("") { s ->
						val tag = if (s.active) " [live]" else ""
						"${s.title}$tag  —  ${s.model ?: ""}"
					})
					.setItemChosenCallback { chosen -> service.openSession(chosen) }
					.createPopup()
					.showUnderneathOf(component)
			}
		}
	}

	private fun scheduleRender() {
		renderQueue.queue(object : Update("render") {
			override fun run() = renderTranscript()
		})
	}

	private fun renderTranscript() {
		val transcript = service.transcript
		val vertical = transcriptScroll.verticalScrollBar
		val atBottom = vertical.value + vertical.visibleAmount >= vertical.maximum - 24
		transcriptPane.text = renderer.render(
			transcript,
			if (service.connectionState == HubConnectionState.CONNECTED) ClineBundle.message("chat.empty") else ClineBundle.message("chat.status.connecting"),
		)
		if (atBottom) {
			SwingUtilities.invokeLater { vertical.value = vertical.maximum }
		}
		val running = transcript.running
		sendButton.text = if (running) ClineBundle.message("chat.stop") else ClineBundle.message("chat.send")
		sendButton.icon = if (running) AllIcons.Actions.Suspend else AllIcons.Actions.Execute
		modeCombo.isEnabled = !running
		transcript.usage?.let { u ->
			usageLabel.text = String.format("%,d in / %,d out · $%.4f", u.inputTokens, u.outputTokens, u.totalCost)
		} ?: run { usageLabel.text = "" }
		val pending = transcript.pendingApprovals.firstOrNull()
		currentApprovalId = pending?.approvalId
		approvalPanel.isVisible = pending != null
		if (pending != null) {
			val gist = TranscriptRenderer.summarizeInput(pending.toolName, pending.input)?.let { " <code>${TranscriptRenderer.escape(it)}</code>" } ?: ""
			approvalLabel.text = "<html><b>${ClineBundle.message("chat.approval.title", TranscriptRenderer.escape(pending.toolName))}</b>$gist</html>"
		}
		if (running) statusLabel.text = ClineBundle.message("chat.status.running") else updateStatus(service.connectionState, service.endpoint, service.connectionError)
	}

	private fun updateStatus(state: HubConnectionState, endpoint: HubEndpoint?, error: Throwable?) {
		when (state) {
			HubConnectionState.CONNECTED -> {
				statusLabel.icon = AllIcons.General.InspectionsOK
				val version = endpoint?.coreVersion?.let { " · core $it" } ?: ""
				statusLabel.text = "${ClineBundle.message("chat.status.connected")} · ${endpoint?.url ?: ""}$version"
				statusLabel.toolTipText = endpoint?.source
			}
			HubConnectionState.CONNECTING -> {
				statusLabel.icon = AnimatedIcon.Default()
				statusLabel.text = ClineBundle.message("chat.status.connecting")
				statusLabel.toolTipText = null
			}
			HubConnectionState.DISCONNECTED -> {
				statusLabel.icon = AllIcons.General.Warning
				val detail = error?.message?.lineSequence()?.firstOrNull()?.let { " · $it" } ?: ""
				statusLabel.text = ClineBundle.message("chat.status.disconnected") + detail
				statusLabel.toolTipText = error?.message
			}
		}
		statusLabel.foreground = if (state == HubConnectionState.DISCONNECTED && error != null) {
			JBColor(ColorUtil.fromHex("C7222A"), ColorUtil.fromHex("F2635E"))
		} else {
			UIUtil.getLabelForeground()
		}
		if (service.transcript.items.isEmpty()) scheduleRender()
	}

	private fun updateSessionLabel(sessionId: String?, title: String?) {
		sessionLabel.text = when {
			sessionId == null -> ClineBundle.message("chat.noSession")
			title.isNullOrBlank() -> "Session $sessionId"
			else -> title
		}
		sessionLabel.toolTipText = sessionId
	}

	private fun onEdt(block: () -> Unit) {
		val app = ApplicationManager.getApplication()
		if (app.isDispatchThread) block() else app.invokeLater(block, ModalityState.any()) { project.isDisposed }
	}

	override fun dispose() {
		removeListener()
	}
}
