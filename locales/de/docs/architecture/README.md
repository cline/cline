# Cline-Erweiterungsarchitektur

Dieses Verzeichnis enthält die Architekturdokumentation für die Cline VSCode-Erweiterung.

## Diagramm der Erweiterungsarchitektur

Die Datei [extension-architecture.mmd](./extension-architecture.mmd) enthält ein Mermaid-Diagramm, das die Architektur der Cline-Erweiterung auf hohem Niveau zeigt. Das Diagramm veranschaulicht:

1. **Kern-Erweiterung**
   - Einstiegspunkt der Erweiterung und Hauptklassen
   - Zustandsverwaltung durch den globalen Zustand und das Geheimnisspeicher von VSCode
   - Kern-Geschäftslogik in der Cline-Klasse

2. **Webview-Benutzeroberfläche**
   - Reaktionsbasierte Benutzeroberfläche
   - Zustandsverwaltung durch ExtensionStateContext
   - Komponentenhierarchie

3. **Speicher**
   - Aufgabenbezogener Speicher für Verlauf und Zustand
   - Git-basierte Checkpoint-System für Dateiänderungen

4. **Datenfluss**
   - Datenfluss der Kern-Erweiterung zwischen Komponenten
   - Datenfluss der Webview-Benutzeroberfläche
   - Bidirektionale Kommunikation zwischen Kern und Webview

## Anzeige des Diagramms

Um das Diagramm anzuzeigen:
1. Installieren Sie eine Mermaid-Diagramm-Viewer-Erweiterung in VSCode
2. Öffnen Sie extension-architecture.mmd
3. Verwenden Sie die Vorschaufunktion der Erweiterung, um das Diagramm zu rendern

Sie können das Diagramm auch auf GitHub anzeigen, das eine integrierte Mermaid-Rendering-Unterstützung bietet.

## Farbschema

Das Diagramm verwendet ein hochkontrastiges Farbschema für bessere Sichtbarkeit:
- Pink (#ff0066): Komponenten für globalen Zustand und Geheimnisspeicher
- Blau (#0066ff): Erweiterungszustandskontext
- Grün (#00cc66): Cline-Anbieter
- Alle Komponenten verwenden weißen Text für maximale Lesbarkeit