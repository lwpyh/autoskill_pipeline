# Execution-Guided Skill Discovery Loop — Process Specification

This document specifies the complete discovery-loop process used in Stage 1 of
AutoSkill (Algorithm 1 of the supplementary material). It is written
model-agnostically: the same process is run independently for each frozen video
MLLM backbone, producing a backbone-specific skill toolbox. All numeric
settings below are those used in our experiments.

## 1. Roles and Components

| Component | Role |
|---|---|
| Discovery agent | An LLM agent that runs the loop end-to-end: failure diagnosis, literature search, proposal packaging, code implementation, test execution, and result analysis. |
| Reviewer model | An independent LLM (different model family from the discovery agent), invoked at maximum reasoning effort. It critically evaluates every literature-grounded hypothesis, writes the candidate skill implementations against a fixed code interface, and scores each cycle with a verdict before any GPU evaluation is spent. |
| Frozen video MLLM | The backbone under study. Its weights are never modified; it is only invoked to answer multiple-choice questions given selected frames (deterministic greedy decoding). It is never invoked inside a skill. |
| Evaluation harness | The open-source `lmms-eval` framework, extended with a thin adapter that intercepts video inputs and executes a configurable frame-selection skill in place of native uniform sampling. |

## 2. Fixed Setup (before Cycle 1)

**Development set.** A capability-focused development set
D_dev (n = 300) is constructed once and reused unchanged across all cycles.
The frozen backbone is first evaluated with the uniform baseline on a large
labelled source pool; 300 samples are then selected so that baseline accuracy
lands in an intermediate band (~60%), stratified by video duration
(short/medium/long, 100 each) and spread across question task types. This
concentrates the set at the backbone's capability boundary: neither saturated
nor hopeless.

**Skill registry.** Skills are registered as
(frame_strategy, prompt_strategy) pairs behind a single interface:

```
frame_strategy : (video_path, question) -> (frames, duration)
                 optionally -> (frames, duration, context_dict)  # text-context injection
```

The registry starts with exactly one entry: the uniform baseline
(`uniform_128_direct`, 128 uniformly sampled frames, direct answer prompt).

**Architecture constraints (enforced every cycle).**

- Fixed frame budget B = 128 for the final answering pass.
- Auxiliary models must each have at most ~1B parameters (e.g., CLIP-family
  encoders, self-supervised vision encoders, open-vocabulary detectors, OCR,
  speech models). No LLM/VLM-based frame re-ranking.
- Any auxiliary computation runs on a small uniform probe of the video
  (32–64 frames), never on every frame.
- The answering pass always uses the same direct multiple-choice prompt: no
  skill modifies the question, options, or answer-format instruction, and
  chain-of-thought / multi-step reasoning scaffolds are banned. A skill's only
  degrees of freedom are in evidence acquisition — which frames enter the
  context window, optionally accompanied by short machine-generated textual
  notes describing the selected evidence.
- Every skill is wrapped in a fallback: any runtime exception silently degrades
  that sample to the uniform baseline (and records the reason).
- No in-loop router/dispatcher: every candidate skill is evaluated
  unconditionally on the full development set. Routing is deferred entirely to
  the separate, later routing-table stage.

## 3. Per-Cycle Loop

Each cycle proposes and evaluates M_c = 5 candidate skills, then feeds the
results back into the next cycle.

### Step 1 — Failure diagnosis

Compute the stratified accuracy of the current baseline (and all previously
evaluated skills) on D_dev, over video duration, question category, and data
source. Identify: (a) the weakest cells, (b) the failure cases of the current
baseline, and (c) for later cycles, which failure cases no evaluated skill has
yet answered correctly. These define the cycle's target categories.

### Step 2 — Literature review (mandatory, every cycle)

Search recent (2022+) training-free video-QA literature for techniques matching
the target failure modes. Every candidate paper must pass a four-condition
gate:

1. Works at inference time without fine-tuning.
2. Uses only auxiliary models within the parameter budget (or none).
3. Published 2022 or later.
4. Not already implemented in the skill registry.

All searched papers — passing or failing — are recorded in a cumulative
literature pool with the gate outcome, so no paper is ever re-searched and
failed papers are never re-proposed. Techniques that fail the gate may still
contribute an adapted idea (recorded explicitly as an adaptation, with the
original paper and the reason for adaptation both noted).

### Step 3 — Proposal via the reviewer model

The discovery agent assembles a self-contained context package and sends it to
the reviewer model:

- full results of all previous cycles (overall accuracy $R(s,\mathcal
  D_{\mathrm{dev}})$ and stratified accuracy over duration, question category,
  and data source);
- confirmed and falsified hypotheses so far, with the evidence;
- the current failure matrix and target categories;
- this cycle's literature findings with gate outcomes;
- the exact code interface, including the verified-current signatures of every
  reusable helper (re-read from source immediately before packaging — never
  quoted from memory);
- all architecture constraints, plus any implementation pitfalls discovered in
  earlier cycles (recorded as explicit "do not repeat" notes).

The reviewer critically evaluates each hypothesis (it may reject hypotheses or
decline to fill proposal slots), returns complete implementations for the
accepted ones, states which categories each skill is expected to improve and
its risks, and scores the cycle with a verdict. Only reviewer-accepted
proposals proceed.

### Step 4 — Implementation with a verification checklist

The discovery agent integrates the reviewer's code into the registry, checking
each proposal against a checklist accumulated from earlier cycles' real bugs,
including:

- interface fidelity (exact signatures; no dead code paths — e.g., evidence
  notes must go through the channel the evaluation adapter actually reads);
- correct device *and* dtype handling for every auxiliary-model tensor;
- reuse of already-validated shared helpers instead of re-implementations;
- known library-version pitfalls (API argument names, deprecated output fields,
  precision-sensitive post-processing).

### Step 5 — CPU smoke tests

Every new skill is executed end-to-end on real samples before any GPU time is
spent: one sample per duration bucket, plus targeted tests for every
conditional branch (e.g., a gated skill is tested on both a sample that should
activate it and one that should not, verifying both the specialized behavior
and the clean fallback).

### Step 6 — GPU evaluation

Each candidate is evaluated unconditionally on all 300 development samples with
deterministic decoding. After every run, a silent-fallback audit compares the
skill's per-sample predictions against the baseline run: a near-total
prediction overlap for a skill that should differ from the baseline indicates a
silently failing skill (this audit caught real, otherwise-invisible failures),
and such results are invalidated and re-run after the cause is fixed.

### Step 7 — Analysis and registry update

For each skill, compute:

- **overall accuracy** $R(s,\mathcal D_{\mathrm{dev}})$ and the gain over the
  uniform baseline;
- **stratified accuracy** over video duration, question category, and data
  source, to verify whether the skill helped its *intended* categories or only
  incidentally, and whether gains in one stratum come at the cost of
  regressions in others.

Results, updated hypotheses (confirmed / falsified, with evidence), and the
literature pool are written back before the next cycle begins.

## 4. Later Cycles: Refinement–Exploration Mix

Cycle 1 proposes five new literature-grounded skills. Later cycles use a mix of
three refinements and two explorations:

- **Refinements** target validated-but-imperfect skills, guided by the
  stratified results (e.g., a skill that genuinely improves its target
  categories but harms unrelated ones receives *tighter activation gating* —
  "do less, more confidently" — rather than added mechanism).
- **Explorations** target categories no prior skill has improved, each with a
  genuinely different mechanism from previous attempts on that category.

Two standing rules, both learned from measured outcomes inside the loop:

1. **Prefer simplification over sophistication.** When a refinement adds
   complexity to a strong skill and underperforms the simpler original, this is
   recorded as evidence, and further elaboration of that family is
   deprioritized.
2. **Dead-end tracking.** A failure mode attacked by multiple mechanistically
   distinct techniques without a net-positive result is declared a dead end and
   recorded; further budget on it requires a genuinely new mechanism, not a
   variation.

## 5. Stopping Criterion and Toolbox Freezing

The loop stops when the evidence indicates convergence rather than at a fixed
cycle count. Signals used: a flat-to-declining trend in the best per-cycle
gain over the uniform baseline; repeated refinement backfires within the
strongest technique families; and a final conservative (tightly gated) cycle
producing near-zero behavioral change in either direction. At that point the Top-K_s skills that
outperform uniform sampling on D_dev are retained and frozen as the toolbox
S*; all other candidates are discarded. Each retained skill's record includes
its mechanism, its source literature (or an explicit "derived from the loop's
own execution feedback" marker with the constituent techniques cited), and its
development-set accuracy.
