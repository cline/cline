# Installation der wesentlichen Entwicklungswerkzeuge mit Cline | Neue Programmierer

Wenn Sie mit dem Programmieren beginnen, benötigen Sie einige wesentliche Entwicklungswerkzeuge, die auf Ihrem Computer installiert sein müssen. Cline kann Ihnen helfen, alles zu installieren, was Sie benötigen, auf eine sichere und geführte Weise.

## Die wesentlichen Werkzeuge

Hier sind die Kernwerkzeuge, die Sie für die Entwicklung benötigen:

-   **Homebrew**: Ein Paketmanager für macOS, der die Installation anderer Werkzeuge erleichtert
-   **Node.js & npm**: Erforderlich für JavaScript und Webentwicklung
-   **Git**: Zum Nachverfolgen von Änderungen in Ihrem Code und zur Zusammenarbeit mit anderen
-   **Python**: Eine Programmiersprache, die von vielen Entwicklungswerkzeugen verwendet wird
-   **Zusätzliche Dienstprogramme**: Werkzeuge wie wget und jq, die beim Herunterladen von Dateien und der Datenverarbeitung helfen

## Lassen Sie Cline alles installieren

Kopieren Sie diesen Hinweis und fügen Sie ihn in Cline ein:

```bash
Hallo Cline! Ich brauche Hilfe beim Einrichten meines Macs für die Softwareentwicklung. Können Sie mir bitte helfen, die wesentlichen Entwicklungswerkzeuge wie Homebrew, Node.js, Git, Python und alle anderen Dienstprogramme zu installieren, die für das Programmieren häufig benötigt werden? Ich möchte, dass Sie mich Schritt für Schritt durch den Prozess führen, erklären, was jedes Werkzeug macht und sicherstellen, dass alles korrekt installiert wird.
```

## Was wird passieren

1. Cline wird zuerst Homebrew installieren, das wie ein "App Store" für Entwicklungswerkzeuge ist
2. Mit Homebrew wird Cline dann andere wesentliche Werkzeuge wie Node.js und Git installieren
3. Für jeden Installationsschritt:
    - Cline wird Ihnen den genauen Befehl zeigen, den es ausführen möchte
    - Sie müssen jeden Befehl vor der Ausführung genehmigen
    - Cline wird jede Installation auf Erfolg überprüfen

## Warum diese Werkzeuge wichtig sind

-   **Homebrew**: Erleichtert die Installation und Aktualisierung von Entwicklungswerkzeugen auf Ihrem Mac
-   **Node.js & npm**: Erforderlich für:
    -   Erstellung von Websites mit React oder Next.js
    -   Ausführung von JavaScript-Code
    -   Installation von JavaScript-Paketen
-   **Git**: Hilft Ihnen:
    -   Verschiedene Versionen Ihres Codes zu speichern
    -   Mit anderen Entwicklern zusammenzuarbeiten
    -   Ihre Arbeit zu sichern
-   **Python**: Wird verwendet für:
    -   Ausführung von Entwicklungsskripten
    -   Datenverarbeitung
    -   Maschinenlernprojekte

## Hinweise

-   Der Installationsprozess ist interaktiv - Cline wird Sie durch jeden Schritt führen
-   Sie müssen möglicherweise Ihr Computerpasswort für einige Installationen eingeben. Wenn Sie dazu aufgefordert werden, werden auf dem Bildschirm keine Zeichen angezeigt. Dies ist normal und eine Sicherheitsfunktion zum Schutz Ihres Passworts. Geben Sie einfach Ihr Passwort ein und drücken Sie Enter.

**Beispiel:**

```bash
$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
Passwort:
```

_Geben Sie hier Ihr Passwort ein, auch wenn nichts auf dem Bildschirm angezeigt wird. Drücken Sie Enter, wenn Sie fertig sind._

-   Alle Befehle werden Ihnen zur Genehmigung angezeigt, bevor sie ausgeführt werden
-   Falls Sie auf Probleme stoßen, wird Cline Ihnen bei der Fehlersuche helfen

## Zusätzliche Tipps für neue Programmierer

### Verständnis des Terminals

Das **Terminal** ist eine Anwendung, in der Sie Befehle eingeben können, um mit Ihrem Computer zu interagieren. Auf macOS können Sie es öffnen, indem Sie in Spotlight nach "Terminal" suchen.

**Beispiel:**

```bash
$ open -a Terminal
```

### Verständnis der VS Code-Funktionen

#### Terminal in VS Code

Das **Terminal** in VS Code ermöglicht es Ihnen, Befehle direkt aus dem Editor heraus auszuführen. Sie können es öffnen, indem Sie zu `Ansicht > Terminal` gehen oder `Strg + ` drücken.

**Beispiel:**

```bash
$ node -v
v16.14.0
```

#### Dokumentenansicht
Die **Dokumentansicht** ist der Ort, an dem Sie Ihre Codedateien bearbeiten. Sie können Dateien öffnen, indem Sie auf sie in der **Explorer**-Leiste auf der linken Seite des Bildschirms klicken.

#### Probleme-Bereich

Der **Probleme**-Bereich in VS Code zeigt alle Fehler oder Warnungen in Ihrem Code an. Sie können darauf zugreifen, indem Sie auf das Glühbirnen-Symbol klicken oder über `Ansicht > Probleme` gehen.

### Gemeinsame Funktionen

-   **Kommandozeilenschnittstelle (CLI)**: Dies ist eine textbasierte Schnittstelle, in der Sie Befehle eingeben, um mit Ihrem Computer zu interagieren. Sie mag zunächst einschüchternd wirken, aber es ist ein mächtiges Werkzeug für Entwickler.
-   **Berechtigungen**: Manchmal müssen Sie bestimmten Anwendungen oder Befehlen Berechtigungen erteilen. Dies ist eine Sicherheitsmaßnahme, um sicherzustellen, dass nur vertrauenswürdige Anwendungen Änderungen an Ihrem System vornehmen können.

## Nächste Schritte

Nach der Installation dieser Tools sind Sie bereit, mit dem Programmieren zu beginnen! Kehren Sie zur [Einstieg in Cline für neue Programmierer](../getting-started-new-coders/README.md)-Anleitung zurück, um Ihre Reise fortzusetzen.