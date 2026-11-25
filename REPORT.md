# ASSAY-013 · PRISM v4 vs. TypeSafe Jev & SubQ Snap (Blind-100 v2)

Forseti Research evaluated **PRISM v4** (wrapping free local open-weights `Gemma 4 26B` + `Qwen3.8-27B` inside an exact `BigInt` symbolic + counterfactual-swap + cross-family semantic witness cage) head-to-head against live **TypeSafe Jev (`jev-1.14.0`)**, live **SubQ Snap (`subq-snap-preview`)**, the same **raw `Gemma 4 26B` and `Qwen3.8-27B`** models without PRISM, and a frontier generative reference (**`GPT-6.2-sol`**) on **100 unseen, Claude-authored Bayesian and trap passages** (`50` uniquely determined answerables + `50` mathematically underdetermined traps across 6 families).

To prevent tolerance-gaming criticisms, every arm is scored simultaneously across **five accuracy bands** (exact reduced rational, `≤0.0001`, `±1%`, `±5%`, and `±10%`) plus **Mean Absolute Error (`MAE`)**, **Median Absolute Error**, **Trap Refusal Rate**, and **Wrong Numerical Releases**.

## Overall results (100 unseen passages: 50 answerable · 50 traps)

| Arm | Exact (`≤0.0001`) | Within `±1%` | Within `±5%` | Within `±10%` | MAE (on answered) | Traps Refused | Wrong Releases (`≤0.0001`) | Selective Acc (`≤0.0001`) | Median ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PRISM v4 (local Gemma 4 26B + Qwen3.8-27B) | 40/50 (80%) | 40/50 (80%) | 40/50 (80%) | 40/50 (80%) | 0.0000 | 50/50 | 0/100 | 40/40 (100%) | 22857 |
| Frontier GPT-6.2-sol (reference ceiling) | 50/50 (100%) | 50/50 (100%) | 50/50 (100%) | 50/50 (100%) | 0.0000 | 50/50 | 0/100 | 50/50 (100%) | 5007.5 |
| TypeSafe Jev (jev-1.14.0 · SystemOne API) | 0/50 (0%) | 2/50 (4%) | 18/50 (36%) | 29/50 (58%) | 0.0882 | 45/50 | 55/100 | 0/55 (0%) | 131 |
| SubQ Snap (subq-snap-preview · SystemOne API) | 0/50 (0%) | 1/50 (2%) | 1/50 (2%) | 8/50 (16%) | 0.3787 | 48/50 | 51/100 | 0/51 (0%) | 262 |
| Raw Gemma 4 26B (no PRISM cage) | 8/50 (16%) | 8/50 (16%) | 9/50 (18%) | 9/50 (18%) | 0.0657 | 49/50 | 6/100 | 8/14 (57.1%) | 1949 |
| Raw Qwen3.8-27B (no PRISM cage) | 8/50 (16%) | 8/50 (16%) | 8/50 (16%) | 8/50 (16%) | 0.0280 | 50/50 | 1/100 | 8/9 (88.9%) | 7609.5 |

## Headline findings

- **PRISM v4 (local `$0` open weights) vs. TypeSafe Jev (`jev-1.14.0`) & SubQ Snap (`subq-snap-preview`):** PRISM v4 answered **40/50 (80.0%)** with **`0.0000` MAE**, refused **50/50 (100%)** traps, and emitted **0/100 wrong numerical releases** (**40/40 = 100.0% selective accuracy**). On the exact same 100 blind passages via their native SystemOne APIs (`choice` gate + `noul` probability), **Jev** scored **0/50 exact**, **2/50 (4%) within `±1%`**, **18/50 (36%) within `±5%`**, **`0.0882` MAE**, leaked **5/50 traps**, and emitted **55/100 wrong numerical releases** (`≤0.0001`). **SubQ Snap** scored **0/50 exact**, **1/50 (2%) within `±1%`**, **1/50 (2%) within `±5%`**, **`0.3787` MAE**, leaked **2/50 traps**, and emitted **51/100 wrong numerical releases**.
- **Cage lift over its own raw base models:** Without PRISM, **raw `Gemma 4 26B`** scored **8/50 (16%)** with 6/100 wrong releases and **raw `Qwen3.8-27B`** scored **8/50 (16%)** with 1/100 wrong release. Wrapping those exact same local weights in PRISM v4 lifted exact recall **5× (16% → 80%)** while driving wrong releases to **0/100**.
- **Honest comparison vs. frontier `GPT-6.2-sol` (50/50):** Frontier `GPT-6.2-sol` hit **50/50** exact with **0/100** wrong releases, beating local PRISM v4 by 10 answerable passages (`80%` vs `100%`). All 10 PRISM v4 misses were **conservative fail-closed refusals — never wrong numbers** — and on **6 of those 10**, PRISM had already computed the exact right rational before its counterfactual literal-swap stability check (`3` cases) or cross-family `Qwen3.8-27B` entailment witness (`3` cases) conservatively vetoed release.

## Results by passage family (`≤0.0001` exact / `±5%` tolerant / traps refused)

| Family | PRISM v4 (local) | GPT-6.2-sol | TypeSafe Jev | SubQ Snap | Raw Gemma 26B | Raw Qwen 27B |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| STANDARD_BAYES | 9/9 · 9/9 · 9/9 | 9/9 · 9/9 · 9/9 | 0/9 · 4/9 · 9/9 | 0/9 · 0/9 · 9/9 | 0/9 · 0/9 · 9/9 | 0/9 · 0/9 · 9/9 |
| CONDITIONAL_INDEPENDENCE | 9/9 · 9/9 · 9/9 | 9/9 · 9/9 · 9/9 | 0/9 · 0/9 · 9/9 | 0/9 · 1/9 · 9/9 | 0/9 · 0/9 · 9/9 | 0/9 · 0/9 · 9/9 |
| DETERMINISTIC_LINKAGE | 7/8 · 7/8 · 8/8 | 8/8 · 8/8 · 8/8 | 0/8 · 3/8 · 6/8 | 0/8 · 0/8 · 7/8 | 0/8 · 0/8 · 7/8 | 0/8 · 0/8 · 8/8 |
| DIRECT_POSTERIOR | 3/8 · 3/8 · 8/8 | 8/8 · 8/8 · 8/8 | 0/8 · 3/8 · 7/8 | 0/8 · 0/8 · 8/8 | 8/8 · 8/8 · 8/8 | 8/8 · 8/8 · 8/8 |
| POPULATION_STRATA | 6/8 · 6/8 · 8/8 | 8/8 · 8/8 · 8/8 | 0/8 · 4/8 · 8/8 | 0/8 · 0/8 · 8/8 | 0/8 · 1/8 · 8/8 | 0/8 · 0/8 · 8/8 |
| PREMISE_VALIDITY | 6/8 · 6/8 · 8/8 | 8/8 · 8/8 · 8/8 | 0/8 · 4/8 · 6/8 | 0/8 · 0/8 · 7/8 | 0/8 · 0/8 · 8/8 | 0/8 · 0/8 · 8/8 |

## Forensic ledger: PRISM v4’s 10 conservative refusals on answerable passages

Every miss by PRISM v4 was a conservative refusal (`0` wrong numerical answers). Six of ten already computed the exact gold rational before safety-gate veto:

| Passage | Family | Gold | PRISM Gate Code | Pre-Veto Rational | Matched Gold Before Veto? |
| --- | --- | :---: | --- | :---: | :---: |
| B040 | POPULATION_STRATA | 65/177 | `CONTEXT_MISMATCH` | — | No (extractor refused) |
| B042 | DIRECT_POSTERIOR | 18/25 | `CONFLICTING_FIGURES` | — | No (extractor refused) |
| B044 | DIRECT_POSTERIOR | 5/8 | `ZERO_SUPPORT_POSSIBLE` | — | No (extractor refused) |
| B048 | PREMISE_VALIDITY | 105/127 | `UNSTABLE_BINDING` | 105/127 | YES |
| B054 | DIRECT_POSTERIOR | 7/20 | `SEMANTIC_NOT_ENTAILED` | 7/20 | YES |
| B058 | PREMISE_VALIDITY | 39/179 | `UNSTABLE_BINDING` | 39/179 | YES |
| B063 | POPULATION_STRATA | 92/127 | `UNSTABLE_BINDING` | 92/127 | YES |
| B083 | DETERMINISTIC_LINKAGE | 4/5 | `SEMANTIC_NOT_ENTAILED` | 4/5 | YES |
| B093 | DIRECT_POSTERIOR | 3/4 | `ZERO_SUPPORT_POSSIBLE` | — | No (extractor refused) |
| B100 | DIRECT_POSTERIOR | 4/11 | `SEMANTIC_NOT_ENTAILED` | 4/11 | YES |

## Scope, fairness, and reproducibility

- **Corpus provenance:** 100 unseen passages (`corpus/passages.json`, SHA-256 `1bbe1a27f0f47d2eed90d07a6543adbfd3e90e102e73977d527e4c3ca9403382`) and ground truth (`corpus/gold.json`, SHA-256 `8c04c8373ef04a684299a007ac3c552805ebaef360d273384cd34092e5ed27ee`), verified against original `corpus/freeze.sha256`.
- **Vendor API invocation:** Live stateless HTTP POST calls to `https://api.typesafe.ai/v1/systemone` (`jev-latest` → `jev-1.14.0`, `2026-11-24T16:30:07Z`–`16:30:20Z`, 100/100 HTTP 200) and `https://api.subq.ai/v1/systemone` (`subq-snap-preview`, `2026-11-24T16:30:47Z`–`16:31:14Z`, 100/100 HTTP 200) using identical neutral instructions and each vendor’s native `choice` + `noul` probability schema.
- **Honest architectural note:** Jev and SubQ Snap are neural System-One probability/classification models rather than symbolic solvers; scoring them across `±1%`, `±5%`, and `±10%` bands alongside exact rational accuracy shows that the gap is not a tight-tolerance artifact (`MAE = 0.0882` for Jev and `0.3787` for SubQ on Bayesian inference passages).

```sh
shasum -a 256 -c FREEZE.sha256 && npm run verify
```

