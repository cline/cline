# Cline Tools Referenzhandbuch

## Was kann Cline?

Cline ist Ihr KI-Assistent, der folgendes kann:

-   Dateien in Ihrem Projekt bearbeiten und erstellen
-   Terminalbefehle ausführen
-   Ihren Code durchsuchen und analysieren
-   Bei der Fehlersuche und Fehlerbehebung helfen
-   Wiederholende Aufgaben automatisieren
-   Mit externen Tools integrieren

## Erste Schritte

1. **Eine Aufgabe starten**

    - Geben Sie Ihre Anfrage im Chat ein
    - Beispiel: "Erstelle eine neue React-Komponente namens Header"

2. **Kontext bereitstellen**

    - Verwenden Sie @ Erwähnungen, um Dateien, Ordner oder URLs hinzuzufügen
    - Beispiel: "@file:src/components/App.tsx"

3. **Änderungen überprüfen**
    - Cline zeigt Diffs an, bevor Änderungen vorgenommen werden
    - Sie können Änderungen bearbeiten oder ablehnen

## Wichtige Funktionen

1. **Dateibearbeitung**

    - Neue Dateien erstellen
    - Vorhandenen Code modifizieren
    - Durchsuchen und Ersetzen über Dateien hinweg

2. **Terminalbefehle**

    - npm-Befehle ausführen
    - Entwicklungsserver starten
    - Abhängigkeiten installieren

3. **Codeanalyse**

    - Fehler finden und beheben
    - Code refaktorisieren
    - Dokumentation hinzufügen

4. **Browserintegration**
    - Webseiten testen
    - Screenshots aufnehmen
    - Konsolenprotokolle inspizieren

## Verfügbare Tools

Für die aktuellsten Implementierungsdetails können Sie den vollständigen Quellcode im [Cline-Repository](https://github.com/cline/cline/blob/main/src/core/Cline.ts) ansehen.

Cline hat Zugriff auf die folgenden Tools für verschiedene Aufgaben:

1. **Dateioperationen**

    - `write_to_file`: Dateien erstellen oder überschreiben
    - `read_file`: Dateiinhalte lesen
    - `replace_in_file`: gezielte Bearbeitungen an Dateien vornehmen
    - `search_files`: Dateien mit Regex durchsuchen
    - `list_files`: Verzeichnisinhalte auflisten

2. **Terminaloperationen**

    - `execute_command`: CLI-Befehle ausführen
    - `list_code_definition_names`: Code-Definitionen auflisten

3. **MCP-Tools**

    - `use_mcp_tool`: Tools von MCP-Servern verwenden
    - `access_mcp_resource`: Ressourcen von MCP-Servern zugreifen
    - Benutzer können benutzerdefinierte MCP-Tools erstellen, auf die Cline dann zugreifen kann
    - Beispiel: Erstellen Sie ein Wetter-API-Tool, das Cline verwenden kann, um Vorhersagen abzurufen

4. **Interaktionstools**
    - `ask_followup_question`: Benutzer um Klärung bitten
    - `attempt_completion`: Endgültige Ergebnisse präsentieren

Jedes Tool hat spezifische Parameter und Nutzungsmuster. Hier sind einige Beispiele:

-   Eine neue Datei erstellen (write_to_file):

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Header-Komponenten-Code
    </content>
    </write_to_file>
    ```

-   Nach einem Muster suchen (search_files):

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   Einen Befehl ausführen (execute_command):
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## Häufige Aufgaben

1. **Eine neue Komponente erstellen**

    - "Erstelle eine neue React-Komponente namens Footer"

2. **Einen Fehler beheben**

    - "Behebe den Fehler in src/utils/format.ts"

3. **Code refaktorisieren**

    - "Refaktorisiere die Button-Komponente, um TypeScript zu verwenden"

4. **Befehle ausführen**
    - "Führe npm install aus, um axios hinzuzufügen"

## Hilfe erhalten

-   [Treten Sie der Discord-Community bei](https://discord.gg/cline)
-   Überprüfen Sie die Dokumentation
-   Geben Sie Feedback, um Cline zu verbessern