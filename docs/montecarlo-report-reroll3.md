# Report Monte Carlo — Variante "max 3 reroll"

Questo report misura la **distribuzione delle categorie di mano** con il vincolo
**max 3 reroll** (almeno 1 dado proprio resta fermo), la regola originale del GDD.
È una variante di confronto: la regola *attuale* del gioco è "reroll fino a 4",
misurata nel report principale [montecarlo-report.md](montecarlo-report.md).

## Come è stato prodotto

Il limite di reroll è ora un parametro del solo simulatore (`SIM_MAX_REROLL`), che
**non cambia le regole dell'engine** (che restano a 4). Riproducibile con:

```bash
SIM_TRIALS=200000 SIM_SEED=20260719 SIM_MAX_REROLL=3 pnpm sim
```

- **Prove per run:** 200.000 mani
- **Seed usati:** `20260719` (run A) e `1` (run B)
- **Vincolo reroll:** max 3 dadi propri (≥ 1 fermo), dado rubato sempre fisso.

## Risultati (max 3 reroll)

| Categoria | Run A (seed 20260719) | Run B (seed 1) | Media | Target GDD | Δ vs GDD |
|---|---:|---:|---:|---:|---:|
| Carta alta | 0,65% | 0,61% | **0,63%** | — | — |
| Coppia | 11,62% | 11,59% | **11,61%** | — | — |
| Doppia coppia | 23,10% | 22,84% | **22,97%** | — | — |
| Tris | 21,88% | 22,07% | **21,98%** | — | — |
| Full house | 20,82% | 20,85% | **20,84%** | 16,50% | **+4,34 pp** |
| Quattro uguali | 11,87% | 11,82% | **11,85%** | — | — |
| Cinque uguali | 1,55% | 1,59% | **1,57%** | — | — |
| Scala di cinque | 4,00% | 4,04% | **4,02%** | 6,00% | **−1,98 pp** |
| Scala di sei | 4,52% | 4,58% | **4,55%** | 6,00% | **−1,45 pp** |

## Confronto: max 3 vs max 4 reroll

| Categoria | Max 3 (media) | Max 4 (media) | Differenza |
|---|---:|---:|---:|
| Carta alta | 0,63% | 0,67% | −0,04 pp |
| Coppia | 11,61% | 11,82% | −0,21 pp |
| Doppia coppia | 22,97% | 22,90% | +0,07 pp |
| Tris | 21,98% | 22,06% | −0,08 pp |
| Full house | 20,84% | 20,75% | +0,09 pp |
| Quattro uguali | 11,85% | 11,69% | +0,16 pp |
| Cinque uguali | 1,57% | 1,57% | 0,00 pp |
| Scala di cinque | 4,02% | 3,97% | +0,05 pp |
| Scala di sei | 4,55% | 4,57% | −0,02 pp |

> I valori "max 4" vengono dal report principale (stessi seed, stesse 200.000 mani).

## Lettura dei risultati

**Passare da max 3 a max 4 reroll cambia pochissimo la distribuzione** (tutte le
differenze sono sotto ~0,2 punti percentuali, dentro il rumore statistico tra seed).

Il motivo è che l'euristica di reroll **raramente vuole rilanciare tutti e 4 i dadi**:
dopo il furto ha quasi sempre almeno un dado utile da tenere (una coppia, un dado
che contribuisce a un set), quindi il quarto reroll — quello che il vincolo "max 3"
vietava — viene scelto solo in casi rari. Togliere il vincolo aggiunge un'opzione che
la strategia usa poco, e l'effetto sulle frequenze è trascurabile.

**Conseguenza pratica:** il vincolo max-3 del GDD **non era la causa** dello
scostamento dai target (full troppi, scale poche). Quel divario resta sostanzialmente
identico anche a max 4 → dipende dalla **strategia di reroll avida sui set**, non dal
numero di dadi rilanciabili. Le leve di bilanciamento sono quelle indicate nel report
principale (strategia "scale-aware", ricalibro dei target, o priorità delle scale).
