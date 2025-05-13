[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • <b>Polski</b> • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Współtworzenie Roo Code

Roo Code to projekt napędzany przez społeczność i bardzo cenimy każdy wkład. Aby usprawnić współpracę, działamy według zasady [Issue-First](#podejście-issue-first), co oznacza, że wszystkie [Pull Requesty (PR)](#zgłaszanie-pull-requesta) muszą najpierw być powiązane z GitHub Issue. Prosimy o uważne zapoznanie się z tym przewodnikiem.

## Spis treści

- [Zanim zaczniesz współtworzyć](#zanim-zaczniesz-współtworzyć)
- [Znajdowanie i planowanie swojego wkładu](#znajdowanie-i-planowanie-swojego-wkładu)
- [Proces rozwoju i zgłaszania](#proces-rozwoju-i-zgłaszania)
- [Prawne](#prawne)

## Zanim zaczniesz współtworzyć

### 1. Kodeks postępowania

Wszyscy współtwórcy muszą przestrzegać naszego [Kodeksu postępowania](./CODE_OF_CONDUCT.md).

### 2. Roadmapa projektu

Nasza roadmapa wyznacza kierunek projektu. Dostosuj swój wkład do tych kluczowych celów:

### Niezawodność przede wszystkim

- Zapewnienie, że edycja różnic i wykonywanie poleceń są konsekwentnie niezawodne
- Zmniejszenie punktów tarcia, które zniechęcają do regularnego użytkowania
- Gwarancja płynnego działania we wszystkich językach i na wszystkich platformach
- Rozszerzenie solidnego wsparcia dla szerokiej gamy dostawców i modeli AI

### Ulepszone doświadczenie użytkownika

- Uproszczenie interfejsu użytkownika dla większej przejrzystości i intuicyjności
- Ciągłe doskonalenie przepływu pracy, aby spełnić wysokie oczekiwania programistów

### Wiodąca pozycja w wydajności agentów

- Ustanowienie kompleksowych punktów odniesienia (evals) do mierzenia produktywności w rzeczywistym świecie
- Ułatwienie wszystkim łatwego uruchamiania i interpretowania tych ocen
- Dostarczanie ulepszeń, które wykazują wyraźny wzrost wyników ocen

Wspomnij o powiązaniu z tymi obszarami w swoich PR.

### 3. Dołącz do społeczności Roo Code

- **Główna metoda:** Dołącz do naszego [Discorda](https://discord.gg/roocode) i wyślij wiadomość prywatną do **Hannes Rudolph (`hrudolph`)**.
- **Alternatywa:** Doświadczeni współtwórcy mogą angażować się bezpośrednio przez [GitHub Projects](https://github.com/orgs/RooVetGit/projects/1).

## Znajdowanie i planowanie swojego wkładu

### Typy wkładów

- **Poprawki błędów:** Naprawianie problemów w kodzie.
- **Nowe funkcje:** Dodawanie nowych funkcjonalności.
- **Dokumentacja:** Ulepszanie przewodników i zwiększanie przejrzystości.

### Podejście Issue-First

Każdy wkład musi zaczynać się od GitHub Issue.

- **Sprawdź istniejące issues:** Przeszukaj [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues).
- **Utwórz issue:** Używaj odpowiednich szablonów:
    - **Błędy:** Szablon "Bug Report".
    - **Funkcje:** Szablon "Detailed Feature Proposal". Wymagane zatwierdzenie przed rozpoczęciem.
- **Zgłoś chęć pracy:** Skomentuj i poczekaj na oficjalne przypisanie.

**PR bez zatwierdzonego issue może zostać zamknięty.**

### Decydowanie, nad czym pracować

- Sprawdź [Projekt GitHub](https://github.com/orgs/RooVetGit/projects/1) w poszukiwaniu nieprzypisanych "Good First Issues".
- W kwestii dokumentacji odwiedź [Roo Code Docs](https://github.com/RooVetGit/Roo-Code-Docs).

### Zgłaszanie błędów

- Najpierw sprawdź istniejące zgłoszenia.
- Twórz nowe zgłoszenia błędów używając [szablonu "Bug Report"](https://github.com/RooVetGit/Roo-Code/issues/new/choose).
- **Luki bezpieczeństwa:** Zgłaszaj prywatnie przez [security advisories](https://github.com/RooVetGit/Roo-Code/security/advisories/new).

## Proces rozwoju i zgłaszania

### Konfiguracja środowiska

1. **Fork & Clone:**

```
git clone https://github.com/TWÓJ_UŻYTKOWNIK/Roo-Code.git
```

2. **Instalacja zależności:**

```
npm run install:all
```

3. **Debugowanie:** Otwórz w VS Code (`F5`).

### Wytyczne dotyczące pisania kodu

- Jeden skoncentrowany PR na funkcję lub poprawkę.
- Przestrzegaj dobrych praktyk ESLint i TypeScript.
- Pisz jasne, opisowe commity odnoszące się do issues (np. `Fixes #123`).
- Zapewnij dokładne testy (`npm test`).
- Zrebase'uj na najnowszą gałąź `main` przed zgłoszeniem.

### Zgłaszanie Pull Requesta

- Zacznij od **wersji roboczej PR**, jeśli szukasz wczesnego feedbacku.
- Jasno opisz swoje zmiany, zgodnie z szablonem Pull Request.
- Dostarcz zrzuty ekranu/wideo dla zmian UI.
- Wskaż, czy potrzebne są aktualizacje dokumentacji.

### Polityka Pull Request

- Musi odnosić się do wcześniej zatwierdzonych i przypisanych issues.
- PR niezgodne z polityką mogą zostać zamknięte.
- PR powinny przechodzić testy CI, być zgodne z roadmapą i mieć jasną dokumentację.

### Proces recenzji

- **Codzienna selekcja:** Szybkie sprawdzenia przez maintainerów.
- **Cotygodniowy dokładny przegląd:** Kompleksowa ocena.
- **Szybko iteruj** na podstawie feedbacku.

## Prawne

Zgłaszając pull request, zgadzasz się, że twój wkład będzie licencjonowany na licencji Apache 2.0, zgodnie z licencją Roo Code.
