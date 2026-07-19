# Poker di Dadi — Prototipo (MVP)

Prototipo giocabile di un poker di dadi 1v1 a turni (Best of 3) contro un bot.
Serve a validare se il loop di gioco è divertente.

## Architettura

Barriera netta tra due livelli:

- **`src/engine/`** — rules engine **puro**, framework-agnostic e portabile (un domani
  in Godot / GDScript-C#). Nessun import da React/DOM/Vite, nessun uso di
  `Date`/`window`/`Math.random`. Tutta la casualità passa da un'interfaccia `Rng`
  iniettata, così i test sono deterministici.
- **`src/ui/`** — presentazione React usa-e-getta. Consuma l'engine, disegna lo stato,
  invia azioni. **Nessuna regola di gioco** vive qui.
- **`src/sim/`** — simulatore Monte Carlo per verificare le probabilità.

Codice, tipi e commenti in **inglese**; testi visibili all'utente in **italiano**.

## Comandi

```bash
npm install        # dipendenze

npm run dev        # dev server UI (Vite)
npm test           # test unitari (Vitest)
npm run typecheck  # type-check TypeScript strict
npm run sim        # simulatore Monte Carlo (tsx)
```

Il simulatore accetta due variabili d'ambiente opzionali:

```bash
SIM_TRIALS=200000 SIM_SEED=42 pnpm sim
```

Stampa la distribuzione delle categorie prodotta dalla strategia condivisa
(furto greedy + reroll euristico fino a 4 dadi), da confrontare con i target
del GDD. Divergenze sono materiale di bilanciamento: la strategia euristica è
tarabile, non è un bug delle regole.

## Come giocare

`pnpm dev`, poi apri il link (di solito http://localhost:5173). Giochi un match
Best of 3 contro il bot. Ogni mano segue la sequenza fissa:

1. **Tiro iniziale** — tu e il bot tirate un dado: chi fa più alto è il primario
   (pareggio → si ritira).
2. **Scommessa iniziale** — il primario apre puntando l'importo che vuole
   (≥ minimo); l'altro deve vedere o rilanciare (niente check, niente fold).
3. **Furto** — clicca un dado comune per rubarlo (il primario ruba per primo).
4. **Scelta rilancio** — seleziona quali dei tuoi 4 dadi rilanciare (tutti tranne
   il rubato), poi conferma.
5. **Seconda scommessa** — il primario punta ≥ della prima; l'altro vede o
   rilancia. Non si può né passare né lasciare.
6. **Showdown** — si confrontano le mani; il vincitore incassa il piatto.

I dadi del bot sono sempre visibili. Il badge accanto ai dadi mostra la categoria
della mano attuale in tempo reale.
