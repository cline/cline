# Cline

<p align="center">
        <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Im VS Marketplace herunterladen</strong></a>
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
<a href="https://cline.bot/join-us" target="_blank"><strong>Wir stellen ein!</strong></a>
</td>
</tbody>
</table>
</div>

Lernen Sie Cline kennen, einen KI-Assistenten, der Ihre **CLI** u**N**d **E**ditor nutzen kann.

Dank der [agentischen Codierungsfähigkeiten von Claude 4 Sonnet](https://www.anthropic.com/claude/sonnet) kann Cline komplexe Softwareentwicklungsaufgaben Schritt für Schritt bewältigen. Mit Werkzeugen, die ihm das Erstellen und Bearbeiten von Dateien, das Erkunden großer Projekte, die Nutzung des Browsers und das Ausführen von Terminalbefehlen (nach Ihrer Genehmigung) ermöglichen, kann er Ihnen auf eine Weise helfen, die über die Codevervollständigung oder technischen Support hinausgeht. Cline kann sogar das Model Context Protocol (MCP) verwenden, um neue Werkzeuge zu erstellen und seine eigenen Fähigkeiten zu erweitern. Während autonome KI-Skripte traditionell in sandboxed Umgebungen laufen, bietet diese Erweiterung eine Mensch-in-der-Schleife-GUI, um jede Dateiänderung und jeden Terminalbefehl zu genehmigen, was eine sichere und zugängliche Möglichkeit bietet, das Potenzial agentischer KI zu erkunden.

1. Geben Sie Ihre Aufgabe ein und fügen Sie Bilder hinzu, um Mockups in funktionale Apps zu konvertieren oder Fehler mit Screenshots zu beheben.
2. Cline beginnt mit der Analyse Ihrer Dateistruktur und Quellcode-ASTs, führt Regex-Suchen durch und liest relevante Dateien, um sich in bestehenden Projekten zurechtzufinden. Durch sorgfältiges Management der hinzugefügten Informationen kann Cline wertvolle Unterstützung auch bei großen, komplexen Projekten bieten, ohne das Kontextfenster zu überladen.
3. Sobald Cline die benötigten Informationen hat, kann er:
                - Dateien erstellen und bearbeiten sowie Linter-/Compiler-Fehler überwachen, um proaktiv Probleme wie fehlende Importe und Syntaxfehler selbst zu beheben.
                - Befehle direkt in Ihrem Terminal ausführen und deren Ausgabe überwachen, sodass er z.B. auf Dev-Server-Probleme reagieren kann, nachdem er eine Datei bearbeitet hat.
                - Für Webentwicklungsaufgaben kann Cline die Website in einem Headless-Browser starten, klicken, tippen, scrollen und Screenshots sowie Konsolenprotokolle erfassen, sodass er Laufzeitfehler und visuelle Fehler beheben kann.
4. Wenn eine Aufgabe abgeschlossen ist, präsentiert Cline das Ergebnis mit einem Terminalbefehl wie `open -a "Google Chrome" index.html`, den Sie mit einem Klick ausführen können.

> [!TIPP]
> Verwenden Sie die Tastenkombination `CMD/CTRL + Shift + P`, um die Befehls-Palette zu öffnen und geben Sie "Cline: Open In New Tab" ein, um die Erweiterung als Tab in Ihrem Editor zu öffnen. So können Sie Cline neben Ihrem Dateiexplorer verwenden und sehen, wie er Ihren Arbeitsbereich verändert.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Verwenden Sie jede API und jedes Modell

Cline unterstützt API-Anbieter wie OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure und GCP Vertex. Sie können auch jede OpenAI-kompatible API konfigurieren oder ein lokales Modell über LM Studio/Ollama verwenden. Wenn Sie OpenRouter verwenden, ruft die Erweiterung deren neueste Modellliste ab, sodass Sie die neuesten Modelle sofort verwenden können, sobald sie verfügbar sind.

Die Erweiterung verfolgt auch die gesamten Token- und API-Nutzungskosten für den gesamten Aufgabenzyklus und einzelne Anfragen, sodass Sie bei jedem Schritt über die Ausgaben informiert sind.

<!-- Transparenter Pixel, um einen Zeilenumbruch nach dem schwebenden Bild zu erzeugen -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Befehle im Terminal ausführen

Dank der neuen [Shell-Integrations-Updates in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api) kann Cline Befehle direkt in Ihrem Terminal ausführen und die Ausgabe empfangen. Dies ermöglicht ihm eine Vielzahl von Aufgaben, von der Installation von Paketen und dem Ausführen von Build-Skripten bis hin zur Bereitstellung von Anwendungen, Verwaltung von Datenbanken und Ausführung von Tests, während er sich an Ihre Entwicklungsumgebung und Toolchain anpasst, um die Aufgabe richtig zu erledigen.

Für lang laufende Prozesse wie Dev-Server verwenden Sie die Schaltfläche "Während des Laufens fortfahren", um Cline die Fortsetzung der Aufgabe zu ermöglichen, während der Befehl im Hintergrund läuft. Während Cline arbeitet, wird er über neue Terminalausgaben benachrichtigt, sodass er auf auftretende Probleme reagieren kann, wie z.B. Kompilierungsfehler beim Bearbeiten von Dateien.

<!-- Transparenter Pixel, um einen Zeilenumbruch nach dem schwebenden Bild zu erzeugen -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### Dateien erstellen und bearbeiten

Cline kann Dateien direkt in Ihrem Editor erstellen und bearbeiten und Ihnen eine Diff-Ansicht der Änderungen präsentieren. Sie können die Änderungen von Cline direkt im Diff-Ansichts-Editor bearbeiten oder rückgängig machen oder Feedback im Chat geben, bis Sie mit dem Ergebnis zufrieden sind. Cline überwacht auch Linter-/Compiler-Fehler (fehlende Importe, Syntaxfehler usw.), sodass er auftretende Probleme selbst beheben kann.

Alle von Cline vorgenommenen Änderungen werden in der Timeline Ihrer Datei aufgezeichnet, was eine einfache Möglichkeit bietet, Änderungen nachzuverfolgen und bei Bedarf rückgängig zu machen.

<!-- Transparenter Pixel, um einen Zeilenumbruch nach dem schwebenden Bild zu erzeugen -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### Den Browser verwenden

Mit der neuen [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) Fähigkeit von Claude 4 Sonnet kann Cline einen Browser starten, Elemente anklicken, Text eingeben und scrollen, dabei Screenshots und Konsolenprotokolle bei jedem Schritt erfassen. Dies ermöglicht interaktives Debugging, End-to-End-Tests und sogar allgemeine Webnutzung! Dies gibt ihm die Autonomie, visuelle Fehler und Laufzeitprobleme zu beheben, ohne dass Sie selbst Fehlerprotokolle kopieren und einfügen müssen.

Versuchen Sie, Cline zu bitten, "die App zu testen", und sehen Sie zu, wie er einen Befehl wie `npm run dev` ausführt, Ihren lokal laufenden Dev-Server in einem Browser startet und eine Reihe von Tests durchführt, um zu bestätigen, dass alles funktioniert. [Sehen Sie sich hier eine Demo an.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparenter Pixel, um einen Zeilenumbruch nach dem schwebenden Bild zu erzeugen -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "ein Werkzeug hinzufügen, das..."

Dank des [Model Context Protocol](https://github.com/modelcontextprotocol) kann Cline seine Fähigkeiten durch benutzerdefinierte Werkzeuge erweitern. Während Sie [community-made servers](https://github.com/modelcontextprotocol/servers) verwenden können, kann Cline stattdessen Werkzeuge erstellen und installieren, die speziell auf Ihren Workflow zugeschnitten sind. Bitten Sie Cline einfach, "ein Werkzeug hinzuzufügen", und er erledigt alles, von der Erstellung eines neuen MCP-Servers bis zur Installation in der Erweiterung. Diese benutzerdefinierten Werkzeuge werden dann Teil von Clines Toolkit und sind bereit, in zukünftigen Aufgaben verwendet zu werden.

-   "ein Werkzeug hinzufügen, das Jira-Tickets abruft": Abrufen von Ticket-ACs und Cline zur Arbeit bringen
-   "ein Werkzeug hinzufügen, das AWS EC2s verwaltet": Überprüfen von Servermetriken und Skalieren von Instanzen
-   "ein Werkzeug hinzufügen, das die neuesten PagerDuty-Vorfälle abruft": Abrufen von Details und Cline bitten, Fehler zu beheben

<!-- Transparenter Pixel, um einen Zeilenumbruch nach dem schwebenden Bild zu erzeugen -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### Kontext hinzufügen

**`@url`:** Fügen Sie eine URL ein, damit die Erweiterung sie abruft und in Markdown konvertiert, nützlich, wenn Sie Cline die neuesten Dokumente geben möchten

**`@problems`:** Fügen Sie Arbeitsbereichsfehler und -warnungen (Panel 'Probleme') hinzu, die Cline beheben soll

**`@file`:** Fügt den Inhalt einer Datei hinzu, sodass Sie keine API-Anfragen verschwenden müssen, um das Lesen der Datei zu genehmigen (+ zum Suchen von Dateien tippen)

**`@folder`:** Fügt die Dateien eines Ordners auf einmal hinzu, um Ihren Workflow noch weiter zu beschleunigen

<!-- Transparenter Pixel, um einen Zeilenumbruch nach dem schwebenden Bild zu erzeugen -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### Checkpoints: Vergleichen und Wiederherstellen

Während Cline eine Aufgabe bearbeitet, erstellt die Erweiterung bei jedem Schritt einen Schnappschuss Ihres Arbeitsbereichs. Sie können die Schaltfläche 'Vergleichen' verwenden, um einen Diff zwischen dem Schnappschuss und Ihrem aktuellen Arbeitsbereich zu sehen, und die Schaltfläche 'Wiederherstellen', um zu diesem Punkt zurückzukehren.

Wenn Sie beispielsweise mit einem lokalen Webserver arbeiten, können Sie 'Nur Arbeitsbereich wiederherstellen' verwenden, um schnell verschiedene Versionen Ihrer App zu testen, und 'Aufgabe und Arbeitsbereich wiederherstellen', wenn Sie die Version gefunden haben, von der aus Sie weiterentwickeln möchten. Dies ermöglicht es Ihnen, sicher verschiedene Ansätze zu erkunden, ohne Fortschritte zu verlieren.

<!-- Transparenter Pixel, um einen Zeilenumbruch nach dem schwebenden Bild zu erzeugen -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Beitrag leisten

Um zum Projekt beizutragen, beginnen Sie mit unserem [Beitragsleitfaden](CONTRIBUTING.md), um die Grundlagen zu lernen. Sie können auch unserem [Discord](https://discord.gg/cline) beitreten, um im Kanal `#contributors` mit anderen Mitwirkenden zu chatten. Wenn Sie auf der Suche nach einer Vollzeitstelle sind, schauen Sie sich unsere offenen Stellen auf unserer [Karriereseite](https://cline.bot/join-us) an!

<details>
<summary>Lokale Entwicklungsanweisungen</summary>

1. Klonen Sie das Repository _(Erfordert [git-lfs](https://git-lfs.com/))_:
                ```bash
                git clone https://github.com/cline/cline.git
                ```
2. Öffnen Sie das Projekt in VSCode:
                ```bash
                code cline
                ```
3. Installieren Sie die notwendigen Abhängigkeiten für die Erweiterung und das Webview-GUI:
                ```bash
                npm run install:all
                ```
4. Starten Sie durch Drücken von `F5` (oder `Run`->`Start Debugging`), um ein neues VSCode-Fenster mit der geladenen Erweiterung zu öffnen. (Möglicherweise müssen Sie die [esbuild problem matchers extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) installieren, wenn Sie auf Probleme beim Erstellen des Projekts stoßen.)

</details>

## Lizenz

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)

