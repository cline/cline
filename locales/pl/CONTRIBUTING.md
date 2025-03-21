# Wkład w Roo Code

Cieszymy się, że jesteś zainteresowany wniesieniem wkładu do Roo Code. Czy naprawiasz błąd, dodajesz funkcję, czy ulepszasz naszą dokumentację, każdy wkład sprawia, że Roo Code staje się mądrzejszy! Aby utrzymać naszą społeczność żywą i przyjazną, wszyscy członkowie muszą przestrzegać naszego [Kodeksu Postępowania](CODE_OF_CONDUCT.md).

## Dołącz do naszej społeczności

Gorąco zachęcamy wszystkich współtwórców do dołączenia do naszej [społeczności Discord](https://discord.gg/roocode)! Bycie częścią naszego serwera Discord pomaga:

- Uzyskać pomoc i wskazówki w czasie rzeczywistym dotyczące Twoich wkładów
- Połączyć się z innymi współtwórcami i członkami głównego zespołu
- Być na bieżąco z rozwojem projektu i jego priorytetami
- Uczestniczyć w dyskusjach, które kształtują przyszłość Roo Code
- Znaleźć możliwości współpracy z innymi programistami

## Zgłaszanie błędów lub problemów

Raporty o błędach pomagają ulepszyć Roo Code dla wszystkich! Przed utworzeniem nowego zgłoszenia, proszę [przeszukaj istniejące](https://github.com/RooVetGit/Roo-Code/issues), aby uniknąć duplikatów. Kiedy jesteś gotowy, aby zgłosić błąd, przejdź do naszej [strony zgłoszeń](https://github.com/RooVetGit/Roo-Code/issues/new/choose), gdzie znajdziesz szablon, który pomoże Ci wypełnić odpowiednie informacje.

<blockquote class='warning-note'>
     🔐 <b>Ważne:</b> Jeśli odkryjesz lukę w zabezpieczeniach, proszę użyj <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">narzędzia bezpieczeństwa Github, aby zgłosić ją prywatnie</a>.
</blockquote>

## Decydowanie nad czym pracować

Szukasz dobrego pierwszego wkładu? Sprawdź problemy w sekcji "Issue [Unassigned]" naszego [projektu Github Roo Code](https://github.com/orgs/RooVetGit/projects/1). Te zostały specjalnie wybrane dla nowych współtwórców i obszarów, gdzie chętnie przyjmiemy pomoc!

Cieszymy się również z wkładu do naszej [dokumentacji](https://docs.roocode.com/)! Czy to poprawianie literówek, ulepszanie istniejących przewodników, czy tworzenie nowych treści edukacyjnych - chcielibyśmy zbudować repozytorium zasobów napędzane przez społeczność, które pomaga każdemu czerpać maksimum z Roo Code. Możesz kliknąć "Edit this page" na dowolnej stronie, aby szybko przejść do odpowiedniego miejsca w Github, aby edytować plik, lub możesz przejść bezpośrednio do https://github.com/RooVetGit/Roo-Code-Docs.

Jeśli planujesz pracować nad większą funkcją, proszę najpierw utwórz [prośbę o funkcję](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop), abyśmy mogli przedyskutować, czy jest ona zgodna z wizją Roo Code. Możesz również sprawdzić naszą [Mapę Drogową Projektu](#mapa-drogowa-projektu) poniżej, aby zobaczyć, czy Twój pomysł pasuje do naszego strategicznego kierunku.

## Mapa Drogowa Projektu

Roo Code posiada jasną mapę drogową rozwoju, która kieruje naszymi priorytetami i przyszłym kierunkiem. Zrozumienie naszej mapy drogowej może pomóc Ci:

- Dostosować swoje wkłady do celów projektu
- Zidentyfikować obszary, w których Twoja wiedza byłaby najbardziej wartościowa
- Zrozumieć kontekst stojący za pewnymi decyzjami projektowymi
- Znaleźć inspirację dla nowych funkcji, które wspierają naszą wizję

Nasza obecna mapa drogowa koncentruje się na sześciu kluczowych filarach:

### Wsparcie dla Dostawców

Dążymy do wspierania jak największej liczby dostawców:

- Bardziej wszechstronne wsparcie dla "OpenAI Compatible"
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Ulepszone wsparcie dla Ollama i LM Studio

### Wsparcie dla Modeli

Chcemy, aby Roo działał jak najlepiej na jak największej liczbie modeli, w tym modeli lokalnych:

- Wsparcie dla modeli lokalnych poprzez niestandardowe promptowanie systemowe i przepływy pracy
- Benchmarki ewaluacyjne i przypadki testowe

### Wsparcie dla Systemów

Chcemy, aby Roo działał dobrze na komputerze każdego:

- Integracja terminala międzyplatformowego
- Silne i spójne wsparcie dla Mac, Windows i Linux

### Dokumentacja

Chcemy kompleksowej, dostępnej dokumentacji dla wszystkich użytkowników i współtwórców:

- Rozszerzone przewodniki użytkownika i tutoriale
- Jasna dokumentacja API
- Lepsze wskazówki dla współtwórców
- Wielojęzyczne zasoby dokumentacji
- Interaktywne przykłady i próbki kodu

### Stabilność

Chcemy znacznie zmniejszyć liczbę błędów i zwiększyć zautomatyzowane testowanie:

- Przełącznik rejestrowania debugowania
- Przycisk kopiowania "Informacji o Maszynie/Zadaniu" do wysyłania z prośbami o pomoc/zgłoszeniami błędów

### Internacjonalizacja

Chcemy, aby Roo mówił językiem każdego:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

Szczególnie witamy wkłady, które przyspieszają realizację celów naszej mapy drogowej. Jeśli pracujesz nad czymś, co jest zgodne z tymi filarami, proszę wspomnij o tym w opisie swojego PR.

## Konfiguracja rozwojowa

1. **Sklonuj** repozytorium:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Zainstaluj zależności**:

```sh
npm run install:all
```

3. **Uruchom webview (aplikację Vite/React z HMR)**:

```sh
npm run dev
```

4. **Debugowanie**:
   Naciśnij `F5` (lub **Uruchom** → **Rozpocznij debugowanie**) w VSCode, aby otworzyć nową sesję z załadowanym Roo Code.

Zmiany w webview pojawią się natychmiast. Zmiany w podstawowym rozszerzeniu będą wymagać ponownego uruchomienia hosta rozszerzenia.

Alternatywnie możesz zbudować plik .vsix i zainstalować go bezpośrednio w VSCode:

```sh
npm run build
```

Plik `.vsix` pojawi się w katalogu `bin/` i można go zainstalować za pomocą:

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## Pisanie i przesyłanie kodu

Każdy może wnieść wkład w kod Roo Code, ale prosimy o przestrzeganie tych wytycznych, aby zapewnić płynną integrację Twoich wkładów:

1. **Utrzymuj Pull Requesty skupione**

    - Ogranicz PR do jednej funkcji lub naprawy błędu
    - Podziel większe zmiany na mniejsze, powiązane PR
    - Podziel zmiany na logiczne commity, które można przeglądać niezależnie

2. **Jakość kodu**

    - Wszystkie PR muszą przejść kontrole CI, które obejmują zarówno linting, jak i formatowanie
    - Rozwiąż wszelkie ostrzeżenia lub błędy ESLint przed przesłaniem
    - Odpowiedz na wszystkie informacje zwrotne od Ellipsis, naszego zautomatyzowanego narzędzia do przeglądu kodu
    - Przestrzegaj najlepszych praktyk TypeScript i zachowaj bezpieczeństwo typów

3. **Testowanie**

    - Dodaj testy dla nowych funkcji
    - Uruchom `npm test`, aby upewnić się, że wszystkie testy przechodzą
    - Zaktualizuj istniejące testy, jeśli Twoje zmiany na nie wpływają
    - Uwzględnij zarówno testy jednostkowe, jak i integracyjne, gdy jest to właściwe

4. **Wytyczne dotyczące commitów**

    - Pisz jasne, opisowe komunikaty commitów
    - Odwołuj się do odpowiednich problemów w commitach, używając #numer-problemu

5. **Przed przesłaniem**

    - Rebase swojej gałęzi na najnowszego maina
    - Upewnij się, że Twoja gałąź buduje się pomyślnie
    - Sprawdź ponownie, czy wszystkie testy przechodzą
    - Przejrzyj swoje zmiany pod kątem wszelkiego kodu debugującego lub logów konsoli

6. **Opis Pull Requesta**
    - Jasno opisz, co robią Twoje zmiany
    - Dołącz kroki do przetestowania zmian
    - Wymień wszelkie istotne zmiany
    - Dodaj zrzuty ekranu dla zmian UI

## Umowa o współpracy

Przesyłając pull request, zgadzasz się, że Twoje wkłady będą licencjonowane na tej samej licencji co projekt ([Apache 2.0](../LICENSE)).
