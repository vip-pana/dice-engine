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
(furto greedy + reroll euristico con vincolo max 3), da confrontare con i target
del GDD (Full house ~16,5%, scale ~6% ciascuna). Divergenze sono materiale di
bilanciamento: la strategia euristica è tarabile, non è un bug delle regole.
