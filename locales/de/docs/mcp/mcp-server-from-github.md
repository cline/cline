# Erstellen von MCP-Servern aus GitHub-Repositorys

Diese Anleitung bietet eine Schritt-für-Schritt-Anleitung, wie man mit Cline einen vorhandenen MCP-Server aus einem GitHub-Repository erstellt.

## **Suchen eines MCP-Servers**

Es gibt mehrere Orte im Internet, um MCP-Server zu finden:

-   **Cline kann MCP-Server automatisch zu seiner Liste hinzufügen, die Sie dann bearbeiten können.** Cline kann Repositorys direkt von GitHub klonen und die Server für Sie erstellen.
-   **GitHub:** Zwei der gängigsten Orte, um MCP-Server auf GitHub zu finden, sind:
    -   [Offizielles MCP-Server-Repository](https://github.com/modelcontextprotocol/servers)
    -   [Awesome-MCP-Server-Repository](https://github.com/punkpeye/awesome-mcp-servers)
-   **Online-Verzeichnisse:** Mehrere Websites listen MCP-Server auf, einschließlich:

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    Diese Verzeichnisse ermöglichen es Benutzern, die Server nach verschiedenen Kriterien wie Downloads, Datum, Sternen und Anwendungsfällen zu sortieren. Jeder Eintrag enthält Informationen wie Funktionen, Tools und Konfigurationsanweisungen.

-   **PulseMCP:** Diese Website hat einen Blogbeitrag, der diskutiert, wie KI MCP-Server verwenden könnte, um Websites überflüssig zu machen. PulseMCP enthält auch einen FAQ-Bereich zu MCP-Servern: [https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **Erstellen mit Cline**

1.  **Prozess starten:** Geben Sie Cline die folgenden Informationen:
    -   **GitHub-Repository-URL:** Die URL des Server-Repositorys.
    -   **README.md-Inhalte:** Dies ist optional, aber hilfreich für Cline, um den Zweck und die Konfiguration des Servers zu verstehen. Sie können die README.md-Datei aus dem GitHub-Repository kopieren.
2.  **Beispielinteraktion mit Cline:**

    ```
    User: "Cline, ich möchte den MCP-Server für die Kontrolle des Brave-Browsers hinzufügen. Hier ist der GitHub-Link: https://github.com/modelcontextprotocol/servers/tree/main/src/brave Kannst du ihn hinzufügen?"

    Cline: "OK. Klonen des Repositorys in das MCP-Verzeichnis. Es muss erstellt werden, weil es eine 'package.json'-Datei hat. Soll ich 'npm run build' ausführen?"

    User: "Ja, baue es."

    Cline: "Erstellung abgeschlossen. Dieser Server benötigt einen Browserpfad. Wo befindet sich Ihre Brave-Browser-Ausführungsdatei?"

    User: "Sie befindet sich in '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'."

    Cline: "OK. Ich habe die Serverkonfiguration mit diesem Pfad aktualisiert und sie zu 'cline_mcp_settings.json' hinzugefügt. Noch etwas?"

    User: "Nein, das ist alles. Lass uns es testen."

    Cline: "Super! Starte den MCP-Inspector, um die Serververbindung zu testen. Danach können wir versuchen, den Browser von Cline aus zu steuern."
    ```
3. **Aktionen von Cline:** Basierend auf Ihren Anweisungen wird Cline Folgendes durchführen:
    - **Repository-Klonen:** Cline wird das Repository auf Ihren lokalen Rechner klonen, normalerweise in das in Ihrer Konfiguration angegebene Verzeichnis.
    - **Anpassungen:** Sie können Cline anleiten, die Konfiguration des Servers zu ändern. Zum Beispiel:
        - **Benutzer:** "Dieser Server benötigt einen API-Schlüssel. Können Sie herausfinden, wo dieser hinzugefügt werden sollte?"
        - Cline kann automatisch die Datei `cline_mcp_settings.json` oder andere relevante Dateien basierend auf Ihren Anweisungen aktualisieren.
    - **Server-Build:** Cline wird den entsprechenden Build-Befehl für den Server ausführen, der normalerweise `npm run build` ist.
    - **Server zu Einstellungen hinzufügen:** Cline wird die Serverkonfiguration zur Datei `cline_mcp_settings.json` hinzufügen.

## **Testen und Fehlerbehebung**

1. **Server testen:** Sobald Cline den Build-Prozess abgeschlossen hat, testen Sie den Server, um sicherzustellen, dass er wie erwartet funktioniert. Cline kann Ihnen helfen, wenn Sie auf Probleme stoßen.
2. **MCP-Inspektor:** Sie können den MCP-Inspektor verwenden, um die Verbindung und Funktionalität des Servers zu testen.

## **Bewährte Praktiken**

- **Grundlagen verstehen:** Während Cline den Prozess vereinfacht, ist es vorteilhaft, ein grundlegendes Verständnis des Servercodes, des MCP-Protokolls () und der Serverkonfiguration zu haben. Dies ermöglicht eine effektivere Fehlerbehebung und Anpassung.
- **Klare Anweisungen:** Geben Sie Cline während des gesamten Prozesses klare und spezifische Anweisungen.
- **Testen:** Testen Sie den Server gründlich nach der Installation und Konfiguration, um sicherzustellen, dass er korrekt funktioniert.
- **Versionskontrolle:** Verwenden Sie ein Versionskontrollsystem (wie Git), um Änderungen am Servercode zu verfolgen.
- **Aktualisiert bleiben:** Halten Sie Ihre MCP-Server auf dem neuesten Stand, um von den neuesten Funktionen und Sicherheitspatches zu profitieren.