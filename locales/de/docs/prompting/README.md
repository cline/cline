# Cline Prompting Leitfaden 🚀

Willkommen zum Cline Prompting Leitfaden! Dieser Leitfaden wird Sie mit den Kenntnissen ausstatten, um effektive Prompts und benutzerdefinierte Anweisungen zu schreiben, um Ihre Produktivität mit Cline zu maximieren.

## Benutzerdefinierte Anweisungen ⚙️

Stellen Sie sich **benutzerdefinierte Anweisungen als Cline's Programmierung** vor. Sie definieren Cline's Basisverhalten und sind **immer "an", beeinflussen alle Interaktionen.**

Um benutzerdefinierte Anweisungen hinzuzufügen:

1. Öffnen Sie VSCode
2. Klicken Sie auf das Cline-Erweiterungseinstellungsrad ⚙️
3. Finden Sie das Feld "Benutzerdefinierte Anweisungen"
4. Fügen Sie Ihre Anweisungen ein

<img width="345" alt="Screenshot 2024-12-26 at 11 22 20 AM" src="https://github.com/user-attachments/assets/00ae689b-d99f-4811-b2f4-fffe1e12f2ff" />

Benutzerdefinierte Anweisungen sind mächtig für:

-   Durchsetzung von Coding-Stil und Best Practices: Stellen Sie sicher, dass Cline immer Ihren Team-Coding-Konventionen, Namenskonventionen und Best Practices folgt.
-   Verbesserung der Codequalität: Ermutigen Sie Cline, lesbareren, wartbareren und effizienteren Code zu schreiben.
-   Anleitung zum Fehlerhandling: Sagen Sie Cline, wie Fehler zu behandeln sind, Fehlermeldungen zu schreiben und Informationen zu protokollieren.

**Der Ordner `custom-instructions` enthält Beispiele für benutzerdefinierte Anweisungen, die Sie verwenden oder anpassen können.**

## .clinerules Datei 📋

Während benutzerdefinierte Anweisungen benutzerspezifisch und global sind (gelten für alle Projekte), bietet die `.clinerules` Datei **projektspezifische Anweisungen**, die im Wurzelverzeichnis Ihres Projekts leben. Diese Anweisungen werden automatisch Ihren benutzerdefinierten Anweisungen hinzugefügt und im Systemprompt von Cline referenziert, um sicherzustellen, dass sie alle Interaktionen im Projektkontext beeinflussen. Dies macht es zu einem ausgezeichneten Werkzeug für:

### Sicherheits-Best Practices 🔒

Um sensible Informationen zu schützen, können Sie Cline anweisen, bestimmte Dateien oder Muster in Ihrer `.clinerules` zu ignorieren. Dies ist besonders wichtig für:

-   `.env` Dateien, die API-Schlüssel und Geheimnisse enthalten
-   Konfigurationsdateien mit sensiblen Daten
-   Private Anmeldeinformationen oder Token

Beispiel für einen Sicherheitsabschnitt in `.clinerules`:

```markdown
# Sicherheit

## Sensible Dateien

LESEN ODER VERÄNDERN SIE NICHT:

-   .env Dateien
-   *_/config/secrets._
-   *_/_.pem
-   Jede Datei, die API-Schlüssel, Token oder Anmeldeinformationen enthält

## Sicherheits-Praktiken

-   Nie sensible Dateien committen
-   Verwenden Sie Umgebungsvariablen für Geheimnisse
-   Halten Sie Anmeldeinformationen aus Logs und Ausgaben heraus
```

### Allgemeine Anwendungsfälle

Die `.clinerules` Datei ist ausgezeichnet für:

-   Aufrechterhaltung von Projektstandards über Teammitglieder hinweg
-   Durchsetzung von Entwicklungspraktiken
-   Verwaltung von Dokumentationsanforderungen
-   Einrichtung von Analyse-Frameworks
-   Definition von projektspezifischen Verhaltensweisen

### Beispielstruktur für .clinerules

```markdown
# Projekt-Richtlinien

## Dokumentationsanforderungen

-   Aktualisieren Sie relevante Dokumentationen in /docs bei der Änderung von Funktionen
-   Halten Sie README.md mit neuen Fähigkeiten synchron
-   Pflegen Sie Einträge im Änderungsprotokoll in CHANGELOG.md

## Architektur-Entscheidungsaufzeichnungen

Erstellen Sie ADRs in /docs/adr für:

-   Große Änderungen an Abhängigkeiten
-   Änderungen an Architekturmustern
-   Neue Integrationsmuster
-   Änderungen am Datenbankschema
    Folgen Sie der Vorlage in /docs/adr/template.md

## Code-Stil & Muster

-   Generieren Sie API-Clients mit OpenAPI Generator
-   Verwenden Sie TypeScript axios Vorlage
-   Platzieren Sie generierten Code in /src/generated
-   Bevorzugen Sie Komposition gegenüber Vererbung
-   Verwenden Sie das Repository-Muster für Datenzugriff
-   Folgen Sie dem Fehlerbehandlungsmuster in /src/utils/errors.ts

## Teststandards

-   Unit-Tests erforderlich für Geschäftslogik
-   Integrationstests für API-Endpunkte
-   E2E-Tests für kritische Benutzerabläufe
```

### Hauptvorteile
1. **Versionskontrolle**: Die Datei `.clinerules` wird Teil des Quellcodes Ihres Projekts
2. **Teameinheitlichkeit**: Stellt einheitliches Verhalten für alle Teammitglieder sicher
3. **Projektspezifisch**: Regeln und Standards, die auf die Bedürfnisse jedes Projekts zugeschnitten sind
4. **Institutionelles Wissen**: Pflegt Projektstandards und -praktiken im Code

Platzieren Sie die Datei `.clinerules` im Stammverzeichnis Ihres Projekts:

```
your-project/
├── .clinerules
├── src/
├── docs/
└── ...
```

Das Systemprompt von Cline ist hingegen nicht vom Benutzer editierbar ([hier finden Sie es](https://github.com/cline/cline/blob/main/src/core/prompts/system.ts)). Für einen breiteren Überblick über die besten Praktiken beim Prompt-Engineering, schauen Sie sich [diese Ressource](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview) an.

### Tipps für das Schreiben effektiver benutzerdefinierter Anweisungen

-   Klar und prägnant sein: Verwenden Sie einfache Sprache und vermeiden Sie Mehrdeutigkeiten.
-   Auf gewünschte Ergebnisse fokussieren: Beschreiben Sie die Ergebnisse, die Sie wollen, nicht die spezifischen Schritte.
-   Testen und iterieren: Experimentieren Sie, um herauszufinden, was für Ihren Workflow am besten funktioniert.


### Unterstützung für das Laden von Dateien aus dem Verzeichnis `.clinerules/`
Alle Dateien unter dem Verzeichnis `.clinerules/` werden rekursiv geladen und ihre Inhalte werden in clineRulesFileInstructions zusammengeführt.

#### Beispiel 1:
```
.clinerules/
├── .local-clinerules
└── .project-clinerules
```

#### Beispiel 2:
```
.clinerules/
├── .clinerules-nextjs
├── .clinerules-serverside
└── tests/
    ├── .pytest-clinerules
    └── .jest-clinerules
```

## Cline ansprechen 💬

**Ansprechen ist die Art und Weise, wie Sie Ihre Bedürfnisse für eine bestimmte Aufgabe im Hin und Her mit Cline kommunizieren.** Cline versteht natürliche Sprache, daher schreiben Sie gesprächig.

Effektives Ansprechen beinhaltet:

-   Bereitstellung klarer Kontexte: Erklären Sie Ihre Ziele und die relevanten Teile Ihres Codes. Verwenden Sie `@`, um auf Dateien oder Ordner zu verweisen.
-   Aufschlüsselung von Komplexität: Teilen Sie große Aufgaben in kleinere Schritte auf.
-   Stellen spezifischer Fragen: Lenken Sie Cline in Richtung des gewünschten Ergebnisses.
-   Validierung und Verfeinerung: Überprüfen Sie die Vorschläge von Cline und geben Sie Feedback.

### Beispielprompts

#### Kontextmanagement

-   **Start einer neuen Aufgabe:** "Cline, lassen Sie uns eine neue Aufgabe beginnen. Erstellen Sie `user-authentication.js`. Wir müssen die Benutzeranmeldung mit JWT-Token implementieren. Hier sind die Anforderungen…"
-   **Zusammenfassung vorheriger Arbeiten:** "Cline, fassen Sie zusammen, was wir bei der letzten Benutzer-Dashboard-Aufgabe gemacht haben. Ich möchte die Hauptmerkmale und ausstehenden Probleme erfassen. Speichern Sie dies in `cline_docs/user-dashboard-summary.md`."

#### Fehlersuche

-   **Analyse eines Fehlers:** "Cline, ich bekomme diesen Fehler: \[Fehlermeldung]. Es scheint von \[Code-Abschnitt] zu kommen. Analysieren Sie diesen Fehler und schlagen Sie eine Lösung vor."
-   **Identifizierung der Ursache:** "Cline, die Anwendung stürzt ab, wenn ich \[Aktion] ausführe. Das Problem könnte in \[Problembereichen] liegen. Helfen Sie mir, die Ursache zu finden und eine Lösung vorzuschlagen."

#### Refactoring

-   **Verbesserung der Code-Struktur:** "Cline, diese Funktion ist zu lang und komplex. Refaktorisieren Sie sie in kleinere Funktionen."
-   **Vereinfachung der Logik:** "Cline, dieser Code ist schwer zu verstehen. Vereinfachen Sie die Logik und machen Sie ihn lesbarer."

#### Feature-Entwicklung
-   **Brainstorming New Features:** "Cline, ich möchte eine Funktion hinzufügen, die es Benutzern ermöglicht, \[Funktionalität]. Brainstormen Sie einige Ideen und berücksichtigen Sie Implementierungsherausforderungen."
-   **Generating Code:** "Cline, erstellen Sie eine Komponente, die Benutzerprofile anzeigt. Die Liste sollte sortierbar und filterbar sein. Generieren Sie den Code für diese Komponente."

## Advanced Prompting Techniques

-   **Constraint Stuffing:** Um Codekürzungen zu vermeiden, fügen Sie explizite Einschränkungen in Ihre Aufforderungen ein. Zum Beispiel: "Stellen Sie sicher, dass der Code vollständig ist" oder "geben Sie immer die vollständige Funktionsdefinition an."
-   **Confidence Checks:** Bitten Sie Cline, sein Vertrauen zu bewerten (z.B. "auf einer Skala von 1-10, wie sicher sind Sie sich über diese Lösung?")
-   **Challenge Cline's Assumptions:** Stellen Sie „dumme“ Fragen, um tiefere Überlegungen zu fördern und falsche Annahmen zu verhindern.

Hier sind einige Aufforderungstipps, die Benutzer beim Arbeiten mit Cline hilfreich fanden:

## Our Community's Favorite Prompts 🌟

### Memory and Confidence Checks 🧠

-   **Memory Check** - _pacnpal_

    ```
    "Wenn du meinen Prompt vollständig verstehst, antworte mit 'YARRR!' ohne Werkzeuge jedes Mal, wenn du ein Werkzeug verwenden willst."
    ```

    Eine lustige Möglichkeit, sicherzustellen, dass Cline bei komplexen Aufgaben auf Kurs bleibt. Probiere "HO HO HO" für eine festliche Note!

-   **Confidence Scoring** - _pacnpal_
    ```
    "Vor und nach jeder Werkzeugnutzung gib mir ein Vertrauensniveau (0-10) darüber, wie die Werkzeugnutzung dem Projekt helfen wird."
    ```
    Fördert kritisches Denken und macht die Entscheidungsfindung transparent.

### Code Quality Prompts 💻

-   **Prevent Code Truncation**

    ```
    "SEI NICHT FAUL. LASS KEINEN CODE WEG."
    ```

    Alternative Phrasen: "nur vollständiger Code" oder "stellen Sie sicher, dass der Code vollständig ist"

-   **Custom Instructions Reminder**
    ```
    "Ich verpflichte mich, die benutzerdefinierten Anweisungen zu befolgen."
    ```
    Verstärkt die Einhaltung Ihrer Einstellungen am Konfigurationsdrehknopf ⚙️.

### Code Organization 📋

-   **Large File Refactoring** - _icklebil_

    ```
    "FILENAME ist zu groß geworden. Analysiere, wie diese Datei funktioniert, und schlage Wege vor, um sie sicher zu fragmentieren."
    ```

    Hilft, komplexe Dateien durch strategische Zerlegung zu verwalten.

-   **Documentation Maintenance** - _icklebil_
    ```
    "Vergiss nicht, die Dokumentation des Codes mit den Änderungen zu aktualisieren"
    ```
    Stellt sicher, dass die Dokumentation mit den Codeänderungen synchron bleibt.

### Analysis and Planning 🔍

-   **Structured Development** - _yellow_bat_coffee_

    ```
    "Bevor du Code schreibst:
    1. Analysiere alle Codedateien gründlich
    2. Hole dir den vollständigen Kontext
    3. Schreibe einen .MD-Implementierungsplan
    4. Implementiere dann den Code"
    ```

    Fördert eine organisierte, gut geplante Entwicklung.

-   **Thorough Analysis** - _yellow_bat_coffee_

    ```
    "bitte beginne mit einer gründlichen Analyse des gesamten Ablaufs, gib immer eine Vertrauensbewertung von 1 bis 10 an"
    ```

    Verhindert voreiliges Programmieren und fördert ein vollständiges Verständnis.

-   **Assumptions Check** - _yellow_bat_coffee_
    ```
    "Liste alle Annahmen und Unsicherheiten auf, die du klären musst, bevor du diese Aufgabe abschließen kannst."
    ```
    Identifiziert potenzielle Probleme früh in der Entwicklung.

### Thoughtful Development 🤔

-   **Pause and Reflect** - _nickbaumann98_

    ```
    "zähle bis 10"
    ```

    Fördert sorgfältige Überlegungen vor der Handlung.

-   **Complete Analysis** - _yellow_bat_coffee_

    ```
    "Vervollständige die Analyse nicht voreilig, setze die Analyse fort, auch wenn du denkst, du hättest eine Lösung gefunden"
    ```

    Stellt sicher, dass das Problem gründlich untersucht wird.
-   **Ständige Vertrauensprüfung** - _pacnpal_
    ```
    "Bewerten Sie das Vertrauen (1-10) vor dem Speichern von Dateien, nach dem Speichern, nach Ablehnungen und vor der Aufgabenabschluss"
    ```
    Erhält die Qualität durch Selbstbewertung.

### Best Practices 🎯

-   **Projektstruktur** - _kvs007_

    ```
    "Überprüfen Sie die Projektdateien, bevor Sie strukturelle oder Abhängigkeitsänderungen vorschlagen"
    ```

    Erhält die Integrität des Projekts.

-   **Kritisches Denken** - _chinesesoup_

    ```
    "Stellen Sie 'dumme' Fragen wie: Sind Sie sicher, dass dies die beste Methode zur Implementierung ist?"
    ```

    Hinterfragt Annahmen und deckt bessere Lösungen auf.

-   **Code-Stil** - _yellow_bat_coffee_

    ```
    Verwenden Sie Wörter wie "elegant" und "einfach" in Aufforderungen
    ```

    Kann die Organisation und Klarheit des Codes beeinflussen.

-   **Erwartungen setzen** - _steventcramer_
    ```
    "DER MENSCH WIRD WÜTEND WERDEN."
    ```
    (Eine humorvolle Erinnerung daran, klare Anforderungen und konstruktives Feedback zu geben)