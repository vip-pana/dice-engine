# Report Monte Carlo — Distribuzione delle mani

Questo report misura la **distribuzione delle categorie di mano** prodotta dalle
regole implementate nell'engine, per verificarla contro i target del GDD e
usarla come base di bilanciamento.

## Cos'è e come è stato prodotto

Il simulatore [src/sim/montecarlo.ts](../src/sim/montecarlo.ts) gioca molte mani
in solitaria con la **stessa strategia del bot** (furto greedy + reroll euristico,
fino a 4 dadi propri, il rubato resta fisso) e conta quante volte esce ogni
categoria. È un metodo Monte Carlo: non calcola le probabilità in forma chiusa,
le **stima** su un gran numero di prove.

Riproducibile con:

```bash
SIM_TRIALS=200000 SIM_SEED=20260719 pnpm sim
```

- **Prove per run:** 200.000 mani
- **Seed usati:** `20260719` (run A) e `1` (run B)
- **Regole vigenti:** 4 dadi propri + 1 rubato dai comuni; reroll euristico fino
  a 4 dadi propri; scale come categorie speciali (Scala di sei > Scala di cinque,
  entrambe battono tutte le mani ordinarie).

## Risultati

| Categoria | Run A (seed 20260719) | Run B (seed 1) | Media | Target GDD | Δ vs GDD |
|---|---:|---:|---:|---:|---:|
| Carta alta | 0,66% | 0,68% | **0,67%** | — | — |
| Coppia | 11,77% | 11,87% | **11,82%** | — | — |
| Doppia coppia | 22,88% | 22,92% | **22,90%** | — | — |
| Tris | 21,99% | 22,13% | **22,06%** | — | — |
| Full house | 20,84% | 20,66% | **20,75%** | 16,50% | **+4,25 pp** |
| Quattro uguali | 11,70% | 11,68% | **11,69%** | — | — |
| Cinque uguali | 1,59% | 1,54% | **1,57%** | — | — |
| Scala di cinque | 4,02% | 3,91% | **3,97%** | 6,00% | **−2,03 pp** |
| Scala di sei | 4,54% | 4,60% | **4,57%** | 6,00% | **−1,43 pp** |

> I due seed concordano entro ~0,15 punti percentuali su ogni categoria: con
> 200.000 prove la stima è stabile.

## Lettura dei risultati

**Le regole sono corrette; la curva di probabilità no (ancora).** Le combinazioni
uguali (coppie, tris, full, quaterne) coprono la stragrande maggioranza delle mani,
mentre le scale escono meno del previsto.

Due scostamenti chiari rispetto al GDD:

1. **Full house sovra-rappresentato** — osservato ~20,7% contro un target del
   16,5% (**+4,3 pp**).
2. **Scale sotto-rappresentate** — ~4,0% (cinque) e ~4,6% (sei) contro un target
   del 6% ciascuna (**−2,0 / −1,4 pp**).

### Perché succede

Non è un bug delle regole: è la **strategia di reroll**, che è avida sui set. Quando
l'euristica vede due o tre dadi uguali tende a tenerli e a inseguire tris/full,
perché il suo punteggio (`handScore`) premia immediatamente la combinazione più
forte disponibile. Di conseguenza "spinge" verso i full e raramente rompe una
coppia per tentare una scala, che è un progetto più rischioso e a payoff ritardato.

In breve: la strategia ottimizza il valore atteso *della categoria attuale*, non la
probabilità di *completare una scala*. Questo gonfia i full e affama le scale.

## Implicazioni di bilanciamento

Questi numeri sono **materiale di playtest**, non un difetto. Se vogliamo avvicinare
i target del GDD, le leve sono:

- **Strategia di reroll** — introdurre nella `strategy.ts` un riconoscimento dei
  "progetti di scala" (4 dadi consecutivi → tenere e cambiare solo il quinto),
  così le scale non vengono quasi mai perseguite oggi.
- **Priorità delle scale** — la loro forza relativa è già data-driven
  (`STRAIGHT_PRIORITY` in [src/engine/hand.ts](../src/engine/hand.ts)): se in
  playtest le scale risultano troppo rare *ma molto premianti*, l'equilibrio può
  restare accettabile anche con frequenze diverse dal GDD.
- **Target del GDD** — i valori 16,5% / 6% erano stimati con il vincolo *max 3
  reroll*. Con l'attuale *reroll fino a 4* i target andrebbero ricalcolati: questo
  report è la nuova baseline di riferimento.

## Prossimi passi suggeriti

1. Aggiungere una variante di strategia "scale-aware" e rilanciare il sim per
   vedere se le scale salgono verso il 6% senza stravolgere il resto.
2. Confrontare le due strategie a parità di seed per isolare l'effetto sul solo
   comportamento di reroll.
3. Decidere in playtest se puntare ai numeri del GDD o adottare questa curva come
   nuovo bilanciamento di riferimento.
