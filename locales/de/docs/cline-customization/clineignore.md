### Unterstützung für .clineignore

Um Ihnen mehr Kontrolle darüber zu geben, welche Dateien für Cline zugänglich sind, haben wir die Funktionalität `.clineignore` implementiert, ähnlich wie `.gitignore`. Dies ermöglicht es Ihnen, Dateien und Verzeichnisse zu spezifizieren, die Cline **nicht** zugreifen oder verarbeiten soll. Dies ist nützlich für:

*   **Datenschutz:** Verhindern, dass Cline auf sensible oder private Dateien in Ihrem Arbeitsbereich zugreift.
*   **Leistung:** Ausschließen großer Verzeichnisse oder Dateien, die für Ihre Aufgaben irrelevant sind, was die Effizienz von Cline potenziell verbessern kann.
*   **Kontextverwaltung:** Fokussieren der Aufmerksamkeit von Cline auf die relevanten Teile Ihres Projekts.

**Wie man `.clineignore` verwendet**

1.  **Erstellen Sie eine `.clineignore`-Datei:** Im Stammverzeichnis Ihres Arbeitsbereichs (auf der gleichen Ebene wie Ihr `.vscode`-Ordner oder das oberste Verzeichnis, das Sie in VS Code geöffnet haben), erstellen Sie eine neue Datei namens `.clineignore`.

2.  **Definieren Sie Ignorierungsmuster:** Öffnen Sie die `.clineignore`-Datei und spezifizieren Sie die Muster für Dateien und Verzeichnisse, die Cline ignorieren soll. Die Syntax ist die gleiche wie bei `.gitignore`:

    *   Jede Zeile in der Datei repräsentiert ein Muster.
    *   **Standard-Glob-Muster werden unterstützt:**
        *   `*` passt zu null oder mehr Zeichen
        *   `?` passt zu einem Zeichen
        *   `[]` passt zu einem Zeichenbereich
        *   `**` passt zu einer beliebigen Anzahl von Verzeichnissen und Unterverzeichnissen.

    *   **Verzeichnismuster:** Fügen Sie `/` am Ende eines Musters an, um ein Verzeichnis zu spezifizieren.
    *   **Negationsmuster:** Beginnen Sie ein Muster mit `!`, um ein zuvor ignoriertes Muster zu negieren (nicht zu ignorieren).
    *   **Kommentare:** Beginnen Sie eine Zeile mit `#`, um Kommentare hinzuzufügen.

    **Beispiel `.clineignore`-Datei:**

    ```
    # Protokolldateien ignorieren
    *.log

    # Das gesamte 'node_modules'-Verzeichnis ignorieren
    node_modules/

    # Alle Dateien im 'temp'-Verzeichnis und seinen Unterverzeichnissen ignorieren
    temp/**

    # Aber 'important.log' NICHT ignorieren, auch wenn es im Root-Verzeichnis ist
    !important.log

    # Jede Datei namens 'secret.txt' in einem beliebigen Unterverzeichnis ignorieren
    **/secret.txt
    ```

3.  **Cline respektiert Ihre `.clineignore`-Datei:** Sobald Sie die `.clineignore`-Datei speichern, erkennt und wendet Cline diese Regeln automatisch an.

    *   **Dateizugriffskontrolle:** Cline kann den Inhalt ignizierter Dateien nicht mit Tools wie `read_file` lesen. Wenn Sie versuchen, ein Tool auf eine ignorierte Datei anzuwenden, informiert Cline Sie, dass der Zugriff aufgrund der `.clineignore`-Einstellungen blockiert ist.
    *   **Dateiauflistung:** Wenn Sie Cline bitten, Dateien in einem Verzeichnis aufzulisten (z.B. mit `list_files`), werden ignorierte Dateien und Verzeichnisse weiterhin aufgelistet, aber sie werden mit einem **🔒**-Symbol neben ihrem Namen markiert, um anzuzeigen, dass sie ignoriert werden. Dies hilft Ihnen zu verstehen, mit welchen Dateien Cline interagieren kann und nicht kann.

4.  **Dynamische Aktualisierungen:** Cline überwacht Ihre `.clineignore`-Datei auf Änderungen. Wenn Sie Ihre `.clineignore`-Datei ändern, erstellen oder löschen, aktualisiert Cline automatisch seine Ignorierungsregeln, ohne dass Sie VS Code oder die Erweiterung neu starten müssen.

**Zusammenfassung**

Die `.clineignore`-Datei bietet eine leistungsstarke und flexible Möglichkeit, den Zugriff von Cline auf die Dateien in Ihrem Arbeitsbereich zu steuern, was den Datenschutz, die Leistung und die Kontextverwaltung verbessert. Durch die Nutzung der vertrauten `.gitignore`-Syntax können Sie den Fokus von Cline leicht auf die relevantesten Teile Ihrer Projekte anpassen.