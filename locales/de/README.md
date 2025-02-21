<div align="center"><sub>
Englisch | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a>
</sub></div>

# Cline: Ihr kollaborativer KI-Partner für anspruchsvolle Ingenieurarbeiten

Verwandeln Sie Ihr Engineering-Team mit einem voll kollaborativen KI-Partner. Open Source, vollständig erweiterbar und darauf ausgelegt, den Einfluss von Entwicklern zu verstärken.

<p align="center">
  <video alt="Cline KI-Agent Demo, der kollaborative Entwicklungsfunktionen zeigt" autoplay loop muted playsinline width="100%">
    <source src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demoForWebsiteNew.mp4" type="video/mp4">
  </video>
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Download im VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>Erste Schritte</strong></a>
</td>
</tbody>
</table>
</div>

Cline ist nicht nur ein autonomer Agent – er ist Ihr KI-Partner zur Optimierung von Entwicklungsabläufen. Er arbeitet mit Ihnen zusammen an einem Plan, bevor er Maßnahmen ergreift, erklärt seine Entscheidungsfindung und zerlegt komplexe Aufgaben Schritt für Schritt. Mit Tools zum Erstellen und Bearbeiten von Dateien, zur Projektübersicht und zur Ausführung von Befehlen behält Cline Ihre Umgebung – von Terminals und Dateien bis hin zu Fehlerprotokollen – stets im Blick, um einen reibungslosen Fortschritt zu gewährleisten.

Während herkömmliche KI-Skripte in isolierten Umgebungen laufen, bietet Cline eine Benutzeroberfläche mit Mensch-in-der-Schleife, um jede Dateiveränderung und jeden Terminalbefehl freizugeben. Durch die Integration des MCP (Model Context Protocol) erweitert Cline seinen Zugriff auf externe Datenbanken und Live-Dokumente, erkennt automatisch Probleme und wendet Korrekturen an, sodass Sie sich auf Innovationen konzentrieren können. Mit Sicherheit auf Unternehmensebene entworfen, können Sie über AWS Bedrock, GCP Vertex oder Azure-Endpunkte auf erstklassige Modelle zugreifen und dabei Ihren Code schützen.

1. Geben Sie Ihre Aufgabe ein und fügen Sie Bilder hinzu, um Entwürfe in funktionale Apps zu verwandeln oder Fehler mithilfe von Screenshots zu beheben.
2. Cline beginnt mit der Analyse Ihrer Dateistruktur und des Quellcode-AST, führt Regex-Suchen durch und liest relevante Dateien, um sich in bestehenden Projekten zurechtzufinden. Durch die sorgfältige Verwaltung der Informationen, die in den Kontext aufgenommen werden, kann Cline auch bei großen, komplexen Projekten wertvolle Unterstützung bieten, ohne dass das Kontextfenster überladen wird.
3. Sobald Cline die benötigten Informationen hat, kann er:
    - Dateien erstellen und bearbeiten sowie Linter-/Compiler-Fehler überwachen, sodass er proaktiv Probleme wie fehlende Importe oder Syntaxfehler selbst beheben kann.
    - Befehle direkt in Ihrem Terminal ausführen und deren Ausgaben überwachen, sodass er beispielsweise auf Probleme des Entwicklungsservers nach dem Bearbeiten einer Datei reagieren kann.
    - Für Webentwicklungsaufgaben kann Cline die Seite in einem Headless-Browser starten, klicken, tippen, scrollen und Screenshots sowie Konsolenprotokolle erfassen, um Laufzeitfehler und visuelle Bugs zu beheben.
4. Nachdem eine Aufgabe abgeschlossen ist, präsentiert Cline Ihnen das Ergebnis mit einem Terminalbefehl wie `open -a "Google Chrome" index.html`, den Sie per Knopfdruck ausführen können.

> [!TIP]
> Verwenden Sie die Tastenkombination `CMD/CTRL + Shift + P`, um die Befehls-Palette zu öffnen und "Cline: Open In New Tab" einzugeben, um die Erweiterung in einem neuen Tab in Ihrem Editor zu öffnen. So können Sie Cline neben Ihrem Dateiexplorer verwenden und besser nachvollziehen, wie er Ihre Arbeitsumgebung verändert.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4" alt="Clines flexible Schnittstelle für Modell-Integrationen">

### Verwenden Sie beliebige APIs und Modelle

Cline unterstützt API-Anbieter wie OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure und GCP Vertex. Sie können auch jede OpenAI-kompatible API konfigurieren oder ein lokales Modell über LM Studio/Ollama verwenden. Falls Sie OpenRouter nutzen, ruft die Erweiterung deren neueste Modellliste ab, sodass Sie die aktuellsten Modelle sofort einsetzen können.

Die Erweiterung verfolgt zudem die Gesamttokenanzahl und die API-Nutzungskosten sowohl für den gesamten Aufgabenzyklus als auch für einzelne Anfragen, sodass Sie jederzeit über Ihre Ausgaben informiert sind.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76" alt="Clines Terminalbefehls-Ausführungsoberfläche">

### Befehle im Terminal ausführen

Dank der neuen [Shell-Integrations-Updates in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api) kann Cline Befehle direkt in Ihrem Terminal ausführen und deren Ausgabe empfangen. Dies ermöglicht ihm, eine breite Palette von Aufgaben zu übernehmen – von der Installation von Paketen und dem Ausführen von Build-Skripten bis hin zur Bereitstellung von Anwendungen, der Verwaltung von Datenbanken und dem Durchführen von Tests –, und sich dabei an Ihre Entwicklungsumgebung und Toolchain anzupassen, um die Arbeit korrekt zu erledigen.

Bei lang laufenden Prozessen wie Entwicklungsservern verwenden Sie die Schaltfläche "Weiter während des Ausführens", um Cline zu ermöglichen, mit der Aufgabe fortzufahren, während der Befehl im Hintergrund läuft. Während seiner Arbeit wird Cline über jede neue Terminalausgabe informiert, sodass er auf auftretende Probleme, wie z.B. Kompilierungsfehler beim Bearbeiten von Dateien, reagieren kann.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588" alt="Clines Dateibearbeitungsoberfläche mit Differenzansicht">

### Dateien erstellen und bearbeiten

Cline kann Dateien direkt in Ihrem Editor erstellen und bearbeiten und zeigt Ihnen dabei eine Diff-Ansicht der vorgenommenen Änderungen. Sie können Clines Änderungen direkt in der Diff-Ansicht bearbeiten oder rückgängig machen bzw. Feedback im Chat geben, bis Sie mit dem Ergebnis zufrieden sind. Zudem überwacht Cline Linter-/Compiler-Fehler (fehlende Importe, Syntaxfehler etc.), sodass er auftretende Probleme selbst beheben kann.

Alle von Cline vorgenommenen Änderungen werden in der Timeline der Datei protokolliert, was es Ihnen erleichtert, Änderungen nachzuverfolgen und bei Bedarf rückgängig zu machen.

<!-- Transparent pixel to create line break after floating image -->

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5" alt="Clines Browser-Automatisierungsoberfläche">

### Den Browser nutzen

Dank der neuen [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use)-Funktion von Claude 3.5 Sonnet kann Cline einen Browser starten, auf Elemente klicken, Text eingeben und scrollen sowie zu jedem Schritt Screenshots und Konsolenlogs erfassen. Dies ermöglicht interaktives Debugging, End-to-End-Tests und sogar allgemeine Webnutzung! So kann er visuelle Fehler und Laufzeitprobleme beheben, ohne dass Sie ihm ständig Anweisungen geben oder Fehlerprotokolle manuell kopieren und einfügen müssen.

Probieren Sie es aus, indem Sie Cline bitten, "die App zu testen", und beobachten Sie, wie er einen Befehl wie `npm run dev` ausführt, Ihren lokal laufenden Entwicklungsserver im Browser öffnet und eine Reihe von Tests durchführt, um sicherzustellen, dass alles reibungslos funktioniert. [Demo ansehen.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd" alt="Clines MCP-Tool-Erstellungsoberfläche">

### „Füge ein Tool hinzu, das...“

Dank des [Model Context Protocol](https://github.com/modelcontextprotocol) kann Cline seine Fähigkeiten durch benutzerdefinierte Tools erweitern. Während Sie [gemeinschaftsbasierte Server](https://github.com/modelcontextprotocol/servers) verwenden können, erstellt und installiert Cline auch Tools, die speziell auf Ihren Workflow zugeschnitten sind. Bitten Sie Cline einfach: „Füge ein Tool hinzu“ und er kümmert sich um alles – von der Erstellung eines neuen MCP-Servers bis hin zur Installation in der Erweiterung. Diese benutzerdefinierten Tools werden dann Teil von Clines Werkzeugkasten und stehen für zukünftige Aufgaben bereit.

- „Füge ein Tool hinzu, das Jira-Tickets abruft“: Rufen Sie Ticket-Codes ab und setzen Sie Cline in Aktion.
- „Füge ein Tool hinzu, das AWS EC2s verwaltet“: Überwachen Sie Servermetriken und skalieren Sie Instanzen nach Bedarf.
- „Füge ein Tool hinzu, das die neuesten PagerDuty-Vorfälle abruft“: Holen Sie Details ein und lassen Sie Cline Fehler beheben.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970" alt="Clines Kontextverwaltungsoberfläche">

### Kontext hinzufügen

**`@url`:** Fügen Sie eine URL ein, damit die Erweiterung sie abrufen und in Markdown umwandeln kann – nützlich, wenn Sie Cline die neuesten Dokumente bereitstellen möchten.

**`@problems`:** Fügen Sie Workspace-Fehler und -Warnungen (das "Problems"-Panel) hinzu, die Cline beheben soll.

**`@file`:** Fügt den Inhalt einer Datei hinzu, sodass Sie API-Anfragen zur Bestätigung des Datei-Inhalts sparen.

**`@folder`:** Fügt alle Dateien eines Ordners auf einmal hinzu, um Ihren Workflow noch weiter zu beschleunigen.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb" alt="Clines Checkpoint-Vergleichsoberfläche">

### Unternehmenssichere Sicherheit

Während Cline an einer Aufgabe arbeitet, erstellt die Erweiterung in jedem Schritt einen Snapshot Ihres Arbeitsbereichs. Sie können die Schaltfläche „Vergleichen“ verwenden, um einen Diff zwischen dem Snapshot und Ihrem aktuellen Arbeitsbereich zu sehen, und mit der Schaltfläche „Wiederherstellen“ zu diesem Zustand zurückkehren.

Beispielsweise können Sie beim Arbeiten mit einem lokalen Webserver die Option „Nur Arbeitsbereich wiederherstellen“ verwenden, um schnell verschiedene Versionen Ihrer App zu testen, und dann „Aufgabe und Arbeitsbereich wiederherstellen“, wenn Sie die Version gefunden haben, auf der Sie weiter aufbauen möchten. So können Sie verschiedene Ansätze sicher ausprobieren, ohne Fortschritte zu verlieren.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Mitwirken

Um zum Projekt beizutragen, starten Sie mit unserem [Contributing Guide](CONTRIBUTING.md), um die Grundlagen zu lernen. Sie können auch unserem [Discord](https://discord.gg/cline) beitreten, um im Kanal `#contributors` mit anderen Mitwirkenden zu chatten. Wenn Sie auf der Suche nach einer Vollzeitstelle sind, schauen Sie sich unsere offenen Positionen auf unserer [Karriereseite](https://cline.bot/join-us) an!

<details>
<summary>Anleitung für die lokale Entwicklung</summary>

1. Klonen Sie das Repository _(benötigt [git-lfs](https://git-lfs.com/))_:
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. Öffnen Sie das Projekt in VSCode:
    ```bash
    code cline
    ```
3. Installieren Sie die notwendigen Abhängigkeiten für die Erweiterung und die Webview-GUI:
    ```bash
    npm run install:all
    ```
4. Starten Sie das Projekt, indem Sie `F5` drücken (oder `Run`->`Start Debugging` wählen), um ein neues VSCode-Fenster mit der geladenen Erweiterung zu öffnen. (Möglicherweise müssen Sie das [esbuild problem matchers Extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) installieren, falls es Probleme beim Bauen des Projekts gibt.)

</details>

<details>
<summary>Einen Pull Request erstellen</summary>

1. Erstellen Sie vor dem Erstellen eines PR einen Changeset-Eintrag:
    ```bash
    npm run changeset
    ```
   Dies wird Sie nach Folgendem fragen:
   - Änderungsart (Major, Minor, Patch)
     - `Major` → Breaking Changes (1.0.0 → 2.0.0)
     - `Minor` → Neue Features (1.0.0 → 1.1.0)
     - `Patch` → Bugfixes (1.0.0 → 1.0.1)
   - Beschreibung Ihrer Änderungen

2. Committen Sie Ihre Änderungen und die erstellte `.changeset`-Datei

3. Pushen Sie Ihren Branch und erstellen Sie einen PR auf GitHub. Unsere CI führt:
   - Tests und Prüfungen aus
   - Changesetbot erstellt einen Kommentar, der die Versionsauswirkung zeigt
   - Nach dem Merge in den Main-Zweig erstellt Changesetbot einen Pull Request für die Versionspakete
   - Nach dem Merge des Versionspaket-PRs wird eine neue Version veröffentlicht

</details>

## Lizenz

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)