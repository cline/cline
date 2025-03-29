# Erste Schritte mit Cline | Neue Programmierer

Willkommen bei Cline! Dieser Leitfaden hilft Ihnen, sich einzurichten und mit Cline zu beginnen, um Ihr erstes Projekt zu erstellen.

## Was Sie benötigen

Bevor Sie beginnen, stellen Sie sicher, dass Sie Folgendes haben:

-   **VS Code:** Ein kostenloser, leistungsstarker Code-Editor.
    -   [VS Code herunterladen](https://code.visualstudio.com/)
-   **Entwicklungswerkzeuge:** Wesentliche Software für die Programmierung (Homebrew, Node.js, Git, etc.).
    -   Folgen Sie unserem Leitfaden [Installieren von wesentlichen Entwicklungswerkzeugen](installing-dev-essentials.md), um diese mit Hilfe von Cline einzurichten (nachdem Sie hier eingerichtet sind)
    -   Cline wird Sie durch die Installation aller benötigten Dinge führen
-   **Cline-Projektordner:** Ein dedizierter Ordner für all Ihre Cline-Projekte.
    -   Auf macOS: Erstellen Sie einen Ordner namens "Cline" in Ihrem Dokumentenordner
        -   Pfad: `/Users/[your-username]/Documents/Cline`
    -   Auf Windows: Erstellen Sie einen Ordner namens "Cline" in Ihrem Dokumentenordner
        -   Pfad: `C:\Users\[your-username]\Documents\Cline`
    -   In diesem Cline-Ordner erstellen Sie separate Ordner für jedes Projekt
        -   Beispiel: `Documents/Cline/workout-app` für eine Workout-Tracking-App
        -   Beispiel: `Documents/Cline/portfolio-website` für Ihre Portfolio-Website
-   **Cline-Erweiterung in VS Code:** Die Cline-Erweiterung in VS Code installiert.

-   Hier ist ein [Tutorial](https://www.youtube.com/watch?v=N4td-fKhsOQ) zu allem, was Sie zum Einstieg benötigen.

## Schritt-für-Schritt-Einrichtung

Folgen Sie diesen Schritten, um Cline in Betrieb zu nehmen:

1. **VS Code öffnen:** Starten Sie die VS Code-Anwendung. Wenn VS Code "Running extensions might..." anzeigt, klicken Sie auf "Allow".

2. **Öffnen Sie Ihren Cline-Ordner:** In VS Code öffnen Sie den Cline-Ordner, den Sie in Dokumenten erstellt haben.

3. **Zu Erweiterungen navigieren:** Klicken Sie auf das Erweiterungssymbol in der Aktivitätsleiste an der Seite von VS Code.

4. **Nach 'Cline' suchen:** Geben Sie in der Erweiterungssuchleiste "Cline" ein.

5. **Erweiterung installieren:** Klicken Sie auf die Schaltfläche "Install" neben der Cline-Erweiterung.

6. **Cline öffnen:** Nach der Installation können Sie Cline auf verschiedene Arten öffnen:
    - Klicken Sie auf das Cline-Symbol in der Aktivitätsleiste.
    - Verwenden Sie die Befehlspalette (`CMD/CTRL + Umschalt + P`) und geben Sie "Cline: In neuem Tab öffnen" ein, um Cline als Tab in Ihrem Editor zu öffnen. Dies wird für eine bessere Ansicht empfohlen.
    - **Fehlerbehebung:** Wenn Sie das Cline-Symbol nicht sehen, versuchen Sie, VS Code neu zu starten.
    - **Was Sie sehen werden:** Sie sollten das Cline-Chat-Fenster in Ihrem VS Code-Editor sehen.

![gettingStartedVsCodeCline](https://github.com/user-attachments/assets/622b4bb7-859b-4c2e-b87b-c12e3eabefb8)

## Einrichten des OpenRouter API-Schlüssels

Nachdem Sie Cline installiert haben, müssen Sie Ihren OpenRouter API-Schlüssel einrichten, um die vollen Möglichkeiten von Cline zu nutzen.
1. **Besorgen Sie Ihren OpenRouter API-Schlüssel:**
   - [Besorgen Sie Ihren OpenRouter API-Schlüssel](https://openrouter.ai/)
2. **Geben Sie Ihren OpenRouter API-Schlüssel ein:**
   - Navigieren Sie zum Einstellungsbutton in der Cline-Erweiterung.
   - Geben Sie Ihren OpenRouter API-Schlüssel ein.
   - Wählen Sie Ihr bevorzugtes API-Modell aus.
     - **Empfohlene Modelle für das Programmieren:**
       - `anthropic/claude-3.5-sonnet`: Am häufigsten für Programmieraufgaben verwendet.
       - `google/gemini-2.0-flash-exp:free`: Eine kostenlose Option für das Programmieren.
       - `deepseek/deepseek-chat`: SUPER GÜNSTIG, fast so gut wie 3.5 sonnet
     - [OpenRouter Modell-Rankings](https://openrouter.ai/rankings/programming)

## Ihr erster Kontakt mit Cline

Jetzt sind Sie bereit, mit Cline zu arbeiten. Lassen Sie uns Ihren ersten Projektordner erstellen und etwas bauen! Kopieren und einfügen Sie den folgenden Prompt in das Cline-Chat-Fenster:

```
Hey Cline! Können Sie mir helfen, einen neuen Projektordner namens "hello-world" in meinem Cline-Verzeichnis zu erstellen und eine einfache Webseite zu erstellen, die "Hello World" in großem blauem Text anzeigt?
```

**Was Sie sehen werden:** Cline wird Ihnen helfen, den Projektordner zu erstellen und Ihre erste Webseite einzurichten.

## Tipps für die Arbeit mit Cline

- **Fragen stellen:** Wenn Sie sich unsicher sind, zögern Sie nicht, Cline zu fragen!
- **Screenshots verwenden:** Cline kann Bilder verstehen, also verwenden Sie gerne Screenshots, um ihm zu zeigen, woran Sie arbeiten.
- **Fehlermeldungen kopieren und einfügen:** Wenn Sie auf Fehler stoßen, kopieren und fügen Sie die Fehlermeldungen in das Cline-Chat ein. Dies hilft ihm, das Problem zu verstehen und eine Lösung zu bieten.
- **Einfach sprechen:** Cline ist darauf ausgelegt, einfache, nicht-technische Sprache zu verstehen. Beschreiben Sie Ihre Ideen in Ihren eigenen Worten, und Cline wird sie in Code umsetzen.

## FAQs

- **Was ist das Terminal?** Das Terminal ist eine textbasierte Schnittstelle zur Interaktion mit Ihrem Computer. Es ermöglicht Ihnen, Befehle auszuführen, um verschiedene Aufgaben zu erledigen, wie das Installieren von Paketen, das Ausführen von Skripten und das Verwalten von Dateien. Cline verwendet das Terminal, um Befehle auszuführen und mit Ihrer Entwicklungsumgebung zu interagieren.
- **Wie funktioniert der Codebase?** (Dieser Abschnitt wird basierend auf häufigen Fragen von neuen Programmierern erweitert)

## Immer noch Schwierigkeiten?

Kontaktieren Sie mich gerne, und ich helfe Ihnen, mit Cline zu beginnen.

nick | 608-558-2410

Treten Sie unserer Discord-Community bei: [https://discord.gg/cline](https://discord.gg/cline)