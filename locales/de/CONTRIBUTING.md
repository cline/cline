# Beitrag zu Cline

Wir freuen uns, dass du daran interessiert bist, zu Cline beizutragen. Ob du einen Fehler behebst, eine Funktion hinzufügst oder unsere Dokumentation verbesserst – jeder Beitrag macht Cline intelligenter! Um unsere Community lebendig und einladend zu halten, müssen alle Mitglieder unseren [Verhaltenskodex](CODE_OF_CONDUCT.md) einhalten.

## Fehler oder Probleme melden

Fehlermeldungen helfen, Cline für alle zu verbessern! Bevor du ein neues Problem erstellst, überprüfe bitte die [bestehenden Probleme](https://github.com/cline/cline/issues), um Duplikate zu vermeiden. Wenn du bereit bist, einen Fehler zu melden, gehe zu unserer [Issues-Seite](https://github.com/cline/cline/issues/new/choose), wo du eine Vorlage findest, die dir hilft, die relevanten Informationen auszufüllen.

<blockquote class='warning-note'>
    🔐 <b>Wichtig:</b> Wenn du eine Sicherheitslücke entdeckst, verwende das <a href="https://github.com/cline/cline/security/advisories/new">GitHub-Sicherheitstool, um sie privat zu melden</a>.
</blockquote>

## Entscheiden, woran man arbeiten möchte

Suchst du nach einem guten ersten Beitrag? Schau dir die mit ["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue) oder ["help wanted"](https://github.com/cline/cline/labels/help%20wanted) gekennzeichneten Issues an. Diese sind speziell für neue Mitwirkende ausgewählt und Bereiche, in denen wir gerne Hilfe erhalten würden!

Wir begrüßen auch Beiträge zu unserer [Dokumentation](https://github.com/cline/cline/tree/main/docs). Ob du Tippfehler korrigierst, bestehende Anleitungen verbesserst oder neue Bildungsinhalte erstellst – wir möchten ein von der Community verwaltetes Ressourcen-Repository aufbauen, das allen hilft, das Beste aus Cline herauszuholen. Du kannst beginnen, indem du `/docs` erkundest und nach Bereichen suchst, die verbessert werden müssen.

Wenn du planst, an einer größeren Funktion zu arbeiten, erstelle bitte zuerst eine [Funktionsanfrage](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop), damit wir besprechen können, ob sie mit der Vision von Cline übereinstimmt.

## Entwicklungsumgebung einrichten

1. **VS Code Erweiterungen**

    - Beim Öffnen des Projekts wird VS Code dich auffordern, die empfohlenen Erweiterungen zu installieren
    - Diese Erweiterungen sind für die Entwicklung erforderlich, bitte akzeptiere alle Installationsanfragen
    - Wenn du die Anfragen abgelehnt hast, kannst du sie manuell im Erweiterungsbereich installieren

2. **Lokale Entwicklung**
    - Führe `npm run install:all` aus, um die Abhängigkeiten zu installieren
    - Führe `npm run test` aus, um die Tests lokal auszuführen
    - Bevor du einen PR einreichst, führe `npm run format:fix` aus, um deinen Code zu formatieren

## Code schreiben und einreichen

Jeder kann Code zu Cline beitragen, aber wir bitten dich, diese Richtlinien zu befolgen, um sicherzustellen, dass deine Beiträge reibungslos integriert werden:

1. **Pull Requests fokussiert halten**

    - Begrenze PRs auf eine einzelne Funktion oder Fehlerbehebung
    - Teile größere Änderungen in kleinere, kohärente PRs auf
    - Teile Änderungen in logische Commits auf, die unabhängig überprüft werden können

2. **Codequalität**

    - Führe `npm run lint` aus, um den Code-Stil zu überprüfen
    - Führe `npm run format` aus, um den Code automatisch zu formatieren
    - Alle PRs müssen die CI-Prüfungen bestehen, die Linting und Formatierung umfassen
    - Behebe alle ESLint-Warnungen oder -Fehler, bevor du einreichst
    - Befolge die Best Practices für TypeScript und halte die Typensicherheit ein

3. **Tests**

    - Füge Tests für neue Funktionen hinzu
    - Führe `npm test` aus, um sicherzustellen, dass alle Tests bestehen
    - Aktualisiere bestehende Tests, wenn deine Änderungen sie beeinflussen
    - Füge sowohl Unit- als auch Integrationstests hinzu, wo es angebracht ist

4. **Commit-Richtlinien**

    - Schreibe klare und beschreibende Commit-Nachrichten
    - Verwende das konventionelle Commit-Format (z.B. "feat:", "fix:", "docs:")
    - Verweise auf relevante Issues in den Commits mit #Issue-Nummer

5. **Vor dem Einreichen**

    - Rebase deinen Branch mit dem neuesten Main
    - Stelle sicher, dass dein Branch korrekt gebaut wird
    - Überprüfe, dass alle Tests bestehen
    - Überprüfe deine Änderungen, um jeglichen Debug-Code oder Konsolenprotokolle zu entfernen

6. **Beschreibung des Pull Requests**
    - Beschreibe klar, was deine Änderungen bewirken
    - Füge Schritte hinzu, um die Änderungen zu testen
    - Liste alle wichtigen Änderungen auf
    - Füge Screenshots für Änderungen an der Benutzeroberfläche hinzu

## Beitragsvereinbarung

Durch das Einreichen eines Pull Requests erklärst du dich damit einverstanden, dass deine Beiträge unter derselben Lizenz wie das Projekt ([Apache 2.0](LICENSE)) lizenziert werden.

Denke daran: Zu Cline beizutragen bedeutet nicht nur, Code zu schreiben, sondern Teil einer Community zu sein, die die Zukunft der KI-gestützten Entwicklung gestaltet. Lass uns gemeinsam etwas Großartiges schaffen! 🚀
