[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • <b>Italiano</b> • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Contribuire a Roo Code

Roo Code è un progetto guidato dalla community e apprezziamo molto ogni contributo. Per garantire un processo fluido ed efficace per tutti, **operiamo secondo un approccio "[Issue-First](#2-principio-chiave-approccio-issue-first)".** Questo significa che ogni lavoro deve essere collegato a una Issue GitHub _prima_ di inviare una Pull Request (vedi la nostra [Politica PR](#politica-di-pull-request-pr) per i dettagli). Leggi attentamente questa guida per capire come contribuire.
Questa guida spiega come contribuire a Roo Code, che tu stia correggendo bug, aggiungendo funzionalità o migliorando la documentazione.

## Indice

- [I. Prima di contribuire](#i-prima-di-contribuire)
    - [1. Codice di condotta](#1-codice-di-condotta)
    - [2. Comprendere la roadmap del progetto](#2-comprendere-la-roadmap-del-progetto)
        - [Supporto provider](#supporto-provider)
        - [Supporto modelli](#supporto-modelli)
        - [Supporto sistemi](#supporto-sistemi)
        - [Documentazione](#documentazione)
        - [Stabilità](#stabilità)
        - [Internazionalizzazione](#internazionalizzazione)
    - [3. Unisciti alla community Roo Code](#3-unisciti-alla-community-roo-code)
- [II. Trovare e pianificare il tuo contributo](#ii-trovare-e-pianificare-il-tuo-contributo)
    - [1. Tipi di contributi](#1-tipi-di-contributi)
    - [2. Principio chiave: Approccio Issue-First](#2-principio-chiave-approccio-issue-first)
    - [3. Decidere su cosa lavorare](#3-decidere-su-cosa-lavorare)
    - [4. Segnalare bug o problemi](#4-segnalare-bug-o-problemi)
- [III. Processo di sviluppo e invio](#iii-processo-di-sviluppo-e-invio)
    - [1. Configurazione dello sviluppo](#1-configurazione-dello-sviluppo)
    - [2. Linee guida per scrivere codice](#2-linee-guida-per-scrivere-codice)
    - [3. Inviare codice: Processo di Pull Request (PR)](#3-inviare-codice-processo-di-pull-request-pr)
        - [Pull Request in bozza](#pull-request-in-bozza)
        - [Descrizione della Pull Request](#descrizione-della-pull-request)
        - [Politica di Pull Request (PR)](#politica-di-pull-request-pr)
            - [Obiettivo](#obiettivo)
            - [Approccio Issue-First](#approccio-issue-first)
            - [Condizioni per PR aperte](#condizioni-per-pr-aperte)
            - [Procedura](#procedura)
            - [Responsabilità](#responsabilità)
- [IV. Legale](#iv-legale)
    - [Accordo di contributo](#accordo-di-contributo)

## I. Prima di contribuire

Per prima cosa, familiarizza con i nostri standard di community e la direzione del progetto.

### 1. Codice di condotta

Tutti i collaboratori devono rispettare il nostro [Codice di condotta](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md). Leggilo prima di contribuire.

### 2. Comprendere la roadmap del progetto

Roo Code ha una roadmap di sviluppo chiara che guida le nostre priorità e la direzione futura. Comprenderla ti aiuta a:

- Allineare i tuoi contributi agli obiettivi del progetto
- Individuare le aree dove la tua esperienza è più preziosa
- Capire il contesto dietro alcune decisioni di design
- Trovare ispirazione per nuove funzionalità che supportano la nostra visione

La nostra roadmap attuale si concentra su sei pilastri chiave:

#### Supporto provider

Vogliamo supportare il maggior numero possibile di provider:

- Più supporto "OpenAI Compatible"
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Supporto migliorato per Ollama e LM Studio

#### Supporto modelli

Vogliamo che Roo funzioni con il maggior numero possibile di modelli, inclusi quelli locali:

- Supporto modelli locali tramite prompt di sistema personalizzati e workflow
- Benchmarking, valutazioni e casi di test

#### Supporto sistemi

Vogliamo che Roo funzioni bene su ogni computer:

- Integrazione terminale multipiattaforma
- Supporto forte e coerente per Mac, Windows e Linux

#### Documentazione

Vogliamo una documentazione completa e accessibile per tutti gli utenti e collaboratori:

- Guide utente e tutorial ampliati
- Documentazione API chiara
- Migliore guida per i collaboratori
- Risorse di documentazione multilingue
- Esempi interattivi e frammenti di codice

#### Stabilità

Vogliamo ridurre significativamente i bug e aumentare i test automatizzati:

- Interruttore per il debug logging
- Pulsante "Informazioni macchina/task" per richieste di bug/supporto

#### Internazionalizzazione

Vogliamo che Roo parli la lingua di tutti:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

Accogliamo con particolare favore i contributi che fanno avanzare gli obiettivi della nostra roadmap. Se stai lavorando su qualcosa che si allinea con questi pilastri, menzionalo nella descrizione della tua PR.

### 3. Unisciti alla community Roo Code

Entrare in contatto con la community Roo Code è un ottimo modo per iniziare:

- **Metodo principale**:
    1.  Unisciti alla [community Roo Code su Discord](https://discord.gg/roocode).
    2.  Una volta dentro, invia un messaggio diretto (DM) a **Hannes Rudolph** (Discord: `hrudolph`) per discutere il tuo interesse e ricevere consigli.
- **Alternativa per collaboratori esperti**: Se ti senti a tuo agio con l'approccio issue-first, puoi partecipare direttamente tramite GitHub seguendo la [Kanban board](https://github.com/orgs/RooVetGit/projects/1) e comunicando tramite issues e pull request.

## II. Trovare e pianificare il tuo contributo

Individua su cosa vuoi lavorare e come affrontarlo.

### 1. Tipi di contributi

Accettiamo vari tipi di contributi:

- **Correzione bug**: Risolvere problemi nel codice esistente.
- **Nuove funzionalità**: Aggiungere nuove funzionalità.
- **Documentazione**: Migliorare guide, esempi o correggere errori di battitura.

### 2. Principio chiave: Approccio Issue-First

**Tutti i contributi devono iniziare con una Issue GitHub.** Questo è fondamentale per garantire l'allineamento ed evitare sforzi inutili.

- **Cerca o crea una Issue**:
    - Prima di iniziare, cerca su [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) se esiste già una issue per il tuo contributo.
    - Se esiste e non è assegnata, commenta per esprimere il tuo interesse. Un maintainer te la assegnerà.
    - Se non esiste, creane una nuova usando il template appropriato sulla nostra [pagina delle issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose):
        - Per i bug, usa il template "Bug Report".
        - Per nuove funzionalità, usa il template "Detailed Feature Proposal". Attendi l'approvazione di un maintainer (soprattutto @hannesrudolph) prima di iniziare a implementare.
        - **Nota**: Idee generali o discussioni preliminari sulle funzionalità possono iniziare su [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests). Quando l'idea è più concreta, crea una issue "Detailed Feature Proposal".
- **Claim e assegnazione**:
    - Indica chiaramente la tua intenzione di lavorare su una issue commentando.
    - Attendi che un maintainer te la assegni ufficialmente su GitHub. Così evitiamo che più persone lavorino sulla stessa cosa.
- **Conseguenze del mancato rispetto**:
    - Le Pull Request (PR) inviate senza una issue corrispondente, pre-approvata e assegnata possono essere chiuse senza revisione completa. Questa politica serve a garantire che i contributi siano allineati con le priorità del progetto e a rispettare il tempo di tutti.

Questo approccio ci aiuta a tracciare il lavoro, garantire che i cambiamenti siano desiderati e coordinare efficacemente gli sforzi.

### 3. Decidere su cosa lavorare

- **Good First Issues**: Consulta la sezione "Issue [Unassigned]" del nostro [progetto Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) su GitHub.
- **Documentazione**: Anche se questo `CONTRIBUTING.md` è la guida principale per i contributi al codice, se vuoi contribuire ad altra documentazione (come guide utente o API), consulta il [repo Roo Code Docs](https://github.com/RooVetGit/Roo-Code-Docs) o chiedi nella community Discord.
- **Proporre nuove funzionalità**:
    1.  **Idea/discussione iniziale**: Per idee generali o iniziali, avvia una discussione su [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests).
    2.  **Proposta formale**: Per proposte specifiche e pronte per la valutazione, crea una issue "Detailed Feature Proposal" usando il template sulla nostra [pagina delle issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose). Questo è fondamentale nel nostro **approccio Issue-First**.

### 4. Segnalare bug o problemi

Se trovi un bug:

1.  **Cerca issues esistenti**: Controlla su [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) se è già stato segnalato.
2.  **Crea una nuova issue**: Se è unico, usa il template "Bug Report" sulla nostra [pagina delle issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose).

> 🔐 **Vulnerabilità di sicurezza**: Se scopri una vulnerabilità di sicurezza, segnalala privatamente tramite lo [strumento di avviso di sicurezza di GitHub](https://github.com/RooVetGit/Roo-Code/security/advisories/new). Non creare una issue pubblica per vulnerabilità di sicurezza.

## III. Processo di sviluppo e invio

Segui questi passaggi per programmare e inviare il tuo lavoro.

### 1. Configurazione dello sviluppo

1.  **Fork & Clona**:
    - Fai il fork del repository su GitHub.
    - Clona il tuo fork localmente: `git clone https://github.com/TUO_USERNAME/Roo-Code.git`
2.  **Installa le dipendenze**: `npm run install:all`
3.  **Esegui Webview (Dev Mode)**: `npm run dev` (per l'app Vite/React con HMR)
4.  **Debugga l'estensione**: Premi `F5` in VS Code (o **Run** → **Start Debugging**) per aprire una nuova finestra Extension Development Host con Roo Code caricato.

Le modifiche al webview (`webview-ui`) appariranno immediatamente grazie all'Hot Module Replacement. Le modifiche all'estensione principale (`src`) richiederanno il riavvio dell'Extension Development Host.

In alternativa, per costruire e installare un pacchetto `.vsix`:

```sh
npm run build
code --install-extension bin/roo-cline-<version>.vsix
```

(Sostituisci `<version>` con il numero di versione reale del file generato).

### 2. Linee guida per scrivere codice

- **PR focalizzate**: Una funzionalità/fix per PR.
- **Qualità del codice**:
    - Superare i check CI (lint, formattazione)
    - Correggere avvisi o errori ESLint (`npm run lint`)
    - Rispondere al feedback degli strumenti automatici di code review
    - Seguire le best practice TypeScript e mantenere la sicurezza dei tipi
- **Testing**:
    - Aggiungere test per nuove funzionalità
    - Eseguire `npm test` per assicurarsi che tutto passi
    - Aggiornare i test esistenti se il tuo cambiamento li influenza
- **Messaggi di commit**:
    - Scrivere messaggi chiari e descrittivi
    - Fare riferimento alle issues rilevanti usando `#numero-issue` (es: `Fixes #123`)
- **Checklist prima di inviare PR**:
    - Rebase della tua branch sull'ultimo `main` dell'upstream
    - Assicurati che il codice compili (`npm run build`)
    - Verifica che tutti i test passino (`npm test`)
    - Rimuovi qualsiasi codice di debug o `console.log`

### 3. Inviare codice: Processo di Pull Request (PR)

#### Pull Request in bozza

Usa PR in bozza per lavori non ancora pronti per una revisione completa ma per cui vuoi:

- Eseguire i check automatici (CI)
- Ricevere feedback precoce dai maintainer o altri collaboratori
- Segnalare che il lavoro è in corso

Segna una PR come "Pronta per la revisione" solo quando tutti i check sono superati e pensi che soddisfi i criteri delle "Linee guida per scrivere codice" e della "Descrizione della Pull Request".

#### Descrizione della Pull Request

La descrizione della tua PR deve essere completa e seguire la struttura del nostro [Template di Pull Request](.github/pull_request_template.md). Punti chiave:

- Un link alla Issue GitHub approvata che affronta
- Descrizione chiara delle modifiche apportate e del loro scopo
- Passaggi dettagliati per testare le modifiche
- Elenco di eventuali breaking changes
- **Per modifiche UI, fornisci screenshot o video prima/dopo**
- **Indica se la tua PR richiede aggiornamenti alla documentazione utente e quali documenti/sezioni sono interessati**

#### Politica di Pull Request (PR)

##### Obiettivo

Mantenere un backlog di PR pulito, focalizzato e gestibile.

##### Approccio Issue-First

- **Richiesto**: Prima di iniziare, deve esistere una Issue GitHub approvata e assegnata (sia "Bug Report" che "Detailed Feature Proposal").
- **Approvazione**: Le Issues, soprattutto per cambiamenti importanti, devono essere riviste e approvate dai maintainer (in particolare @hannesrudolph) _prima_ di iniziare a programmare.
- **Riferimento**: Le PR devono fare riferimento esplicito a queste Issues pre-approvate nella descrizione.
- **Conseguenze**: Il mancato rispetto di questo processo può comportare la chiusura della PR senza revisione completa.

##### Condizioni per PR aperte

- **Pronta per il merge**: Supera tutti i test CI, è allineata con la roadmap (se applicabile), è collegata a una Issue approvata e assegnata, ha documentazione/commenti chiari, include immagini/video prima/dopo per modifiche UI
- **Da chiudere**: Fallimenti CI, conflitti di merge importanti, disallineamento con gli obiettivi del progetto o inattività prolungata (>30 giorni senza aggiornamenti dopo feedback)

##### Procedura

1.  **Qualificazione e assegnazione Issue**: @hannesrudolph (o altri maintainer) esaminano e assegnano le nuove ed esistenti Issues.
2.  **Triage iniziale PR (giornaliero)**: I maintainer fanno una rapida revisione dei nuovi PR per filtrare urgenze o problemi critici.
3.  **Revisione approfondita PR (settimanale)**: I maintainer esaminano a fondo i PR per valutarne la prontezza, l'allineamento con la Issue approvata e la qualità generale.
4.  **Feedback dettagliato e iterazione**: In base alla revisione, i maintainer forniscono feedback (Approve, Request Changes, Reject). I collaboratori sono tenuti a rispondere e migliorare se necessario.
5.  **Fase decisionale**: I PR approvati vengono uniti. I PR con problemi irrisolvibili o non allineati possono essere chiusi con spiegazione.
6.  **Follow-up**: Gli autori dei PR chiusi possono risolvere i problemi e aprirne di nuovi se necessario.

##### Responsabilità

- **Qualificazione Issue & rispetto del processo (@hannesrudolph & maintainer)**: Assicurarsi che tutti i contributi seguano l'approccio Issue-First. Guidare i collaboratori nel processo.
- **Maintainer (Dev Team)**: Revisionare i PR, fornire feedback tecnico, prendere decisioni di approvazione/rifiuto, unire i PR.
- **Collaboratori**: Assicurarsi che i PR siano collegati a una Issue approvata e assegnata, rispettino le linee guida di qualità e rispondano prontamente al feedback.

Questa politica garantisce chiarezza e integrazione efficiente.

## IV. Legale

### Accordo di contributo

Inviando una pull request, accetti che i tuoi contributi siano concessi in licenza sotto la [Licenza Apache 2.0](LICENSE) (o la licenza attuale del progetto), come il progetto.
