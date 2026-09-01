# AutoSkill: Automatic Video Skill Routing for Long-Video Understanding

AutoSkill is a category-based video sampling skill routing method. By classifying input questions into 19 categories, it automatically selects the optimal video sampling strategy (skill) to improve VideoLLM performance on long-video understanding benchmarks.

## Pipeline Overview

```
Stage 1: Skill Discovery     — Rank skills on N1800+supplement, select Top-5
Stage 2: Rewrite Train Set   — Rewrite training queries to match benchmark style
Stage 3: Build Router Table  — Learn category→skill mapping from 1500 training samples
Stage 4: Classify Benchmark  — Qwen2.5-VL classify valuable benchmark samples
Stage 5: Evaluate            — Route + evaluate on 5 benchmarks
```

Stage 1's skill-discovery loop follows the process specified in
[`SKILL.md`](SKILL.md) (failure diagnosis → literature review → reviewer-model
proposal → implementation → CPU smoke tests → GPU evaluation → analysis,
repeated per cycle until convergence).

## Key Concepts

### 6 Candidate Skills (Top-5 + Baseline)

| Skill | Description |
|-------|-------------|
| `siglip_mmr_diverse` | SigLIP + MMR diversity sampling |
| `clip_spatial_cooccur` | CLIP spatial co-occurrence sampling |
| `clip_count_topk` | CLIP count top-k sampling |
| `siglip_ocr_text_aware` | SigLIP OCR text-aware sampling |
| `clip_mmr_diverse` | CLIP + MMR diversity sampling |
| `uniform_128_direct` | Uniform 128-frame sampling (baseline) |

### 19 Question Categories

`action_recognition`, `anomaly_detection`, `appearance`, `causal_reasoning`, `counting`, `emotion_state`, `event_identification`, `fact_verification`, `general_qa`, `narrative_plot`, `negative_qa`, `object_identification`, `ocr_text`, `other`, `person_attribute`, `spatial_location`, `temporal_ordering`, `timestamp_specific`, `yes_no`

### Valuable vs Non-valuable Samples

- **Non-valuable** (all skills correct / all wrong): No routing needed — all correct → correct, all wrong → wrong
- **Valuable** (skills disagree): Route via Qwen2.5-VL classification → router table → skill

### Evaluation

- `mlvu` / `mlvu_test`: task_type macro-average
- `videomme` / `longvideobench` / `lvbench`: sample-level average
- Final result = average of 5 benchmarks

## Data

The skill-discovery loop's development data (Stage 1) is published on the
Hugging Face Hub:
**[Cade921/AutoSkill_dev](https://huggingface.co/datasets/Cade921/AutoSkill_dev)**

| File | n | Role |
|---|---|---|
| `dev300.json` | 300 | Development set (`D_dev`) — drives every discovery-loop cycle. Stratified 100/100/100 across short/medium/long duration. |
| `pool3000.json` | 3000 | Larger labelled source pool that `dev300.json` was sampled from. |

This is a compiled/derived set (video QA sourced from VideoVista, ALLVB,
LLaVA-Video-178K, SpaceR-151k, and longvideo-reason) released under
CC-BY-NC-SA-4.0; see the dataset card for per-source licenses and attribution.
No video files are redistributed — each sample points to its source video
via `data_source` + `video_relpath`.

## Usage

### Quick Start

```bash
# Set paths (modify to your environment)
export MODEL_PATH=/path/to/Qwen2.5-VL-7B-Instruct
export BENCH_DIR=/path/to/benchmark_results
export N1800_RESULTS=/path/to/N1800_results.json
export SUPP_RESULTS=/path/to/supplement_results.json
export N1800_META=/path/to/n1800_metadata.json
export SUPP_META=/path/to/supp_metadata.json
export TRAIN_JSON=/path/to/train_samples.json
export BENCH_QUERIES=/path/to/benchmark_queries.json
export IDEAL_TABLE=/path/to/ideal_router_table.json

# Run full pipeline
bash run_pipeline.sh

# Or run specific stages
bash run_pipeline.sh --stage 3          # Build router table only
bash run_pipeline.sh --stages 3,4,5     # Build router → classify → evaluate
```

### Stage-by-stage

```bash
# Stage 1: Skill Discovery
python stage1_skill_discovery.py \
    --n1800-results $N1800_RESULTS \
    --supp-results $SUPP_RESULTS \
    --n1800-meta $N1800_META \
    --supp-meta $SUPP_META \
    --output outputs/top5_skills.json

# Stage 2: Rewrite Training Set
python stage2_rewrite_trainset.py \
    --train-json $TRAIN_JSON \
    --bench-queries $BENCH_QUERIES \
    --model-path $MODEL_PATH \
    --output outputs/train_rewritten.json

# Stage 3: Build Router Table
python stage3_build_router.py \
    --train-samples $TRAIN_SAMPLES \
    --top5-skills outputs/top5_skills.json \
    --output outputs/router_table.json

# Stage 4: Classify Benchmark Samples
python stage4_classify_benchmark.py \
    --bench-dir $BENCH_DIR \
    --skills "siglip_mmr_diverse,clip_spatial_cooccur,clip_count_topk,siglip_ocr_text_aware,clip_mmr_diverse,uniform_128_direct" \
    --model-path $MODEL_PATH \
    --output outputs/cls_pred_v3.json

# Stage 5: Evaluate
python stage5_evaluate.py \
    --bench-dir $BENCH_DIR \
    --skills "siglip_mmr_diverse,clip_spatial_cooccur,clip_count_topk,siglip_ocr_text_aware,clip_mmr_diverse,uniform_128_direct" \
    --router-table outputs/router_table.json \
    --cls-pred outputs/cls_pred_v3.json
```

## File Structure

```
autoskill_pipeline/
├── README.md                      # This file
├── SKILL.md                       # Stage 1 discovery-loop process specification
├── run_pipeline.sh                # Full pipeline runner
├── stage1_skill_discovery.py      # Rank skills, select Top-5
├── stage2_rewrite_trainset.py    # Rewrite training queries (style alignment)
├── stage3_build_router.py        # Learn category→skill mapping from 1500 samples
├── stage4_classify_benchmark.py   # Qwen2.5-VL 19-class classification
├── stage5_evaluate.py            # Route + evaluate on 5 benchmarks
├── skills/                       # Skill implementations
│   └── skills.py                 # Frame selection strategies
├── lmms_eval_model/              # lmms-eval model adapter
│   └── qwen2_5_vl_skill.py       # Qwen2.5-VL with pluggable skills
├── scripts/                      # Benchmark run scripts
│   ├── run_benchmark_skill.sh    # Run single skill × single benchmark
│   └── run_all_skills.sh         # Run all skills × all benchmarks
└── data/                         # Pre-computed data
    ├── top5_skills.json          # Top-5 skill list
    ├── router_table.json         # Final router table
    └── aligned_samples.jsonl     # 1500 training samples
```

## Results (Qwen2.5-VL-7B)

| Benchmark | Baseline | Single Best | AutoSkill | Δ |
|-----------|---------|-------------|-----------|---|
| MLVU | 66.0 | 68.3 | 69.0 | +3.0 |
| MLVU-test | 47.7 | 51.5 | 51.1 | +3.4 |
| LongVideoBench | 61.2 | 61.6 | 61.9 | +0.7 |
| VideoMME | 64.6 | 65.3 | 65.2 | +0.6 |
| LVBench | 42.1 | 46.2 | 46.8 | +4.7 |
| **Average** | **56.3** | **58.6** | **58.8** | **+2.5** |

## Classification Prompt (v3)

```
Classify this video question-answering query into exactly ONE category.
Categories:
- ocr_text: the question asks what text, words, subtitles, captions, signs, or labels are shown or written
- object_identification: the question asks what a specific physical object, tool, food, or animal is
- person_attribute: the question asks who a person is, or what they wear, carry, or hold
- appearance: the question asks about color, shape, size, pattern, or visual look of something
- action_recognition: the question asks what someone or something is doing
- counting: the question asks how many or the number of something
- temporal_ordering: the question asks about the order or sequence of events
- spatial_location: the question asks where something is located
- timestamp_specific: the question asks about a specific time or moment in the video
- causal_reasoning: the question asks why something happens or the reason
- narrative_plot: the question asks for a summary, main topic, or overall content of the video
- anomaly_detection: the question asks about abnormal, unusual, or unexpected events
- emotion_state: the question asks about emotion, mood, feeling, or expression
- event_identification: the question asks to identify a named event, competition, award, film, or match
- fact_verification: the question asks which statement or description is correct
- general_qa: the question is a generic factual question not fitting other categories
- negative_qa: the question asks what does NOT appear or is NOT included
- yes_no: the question can be answered with yes or no
- other: the question does not fit any of the above categories

Question: {question}

Reply with ONLY the category name (lowercase, exactly as listed), nothing else.
```

## Dependencies

- Python 3.10+
- PyTorch 2.0+
- transformers
- Qwen2.5-VL model weights
- lmms-eval (for benchmark evaluation)
- decord (video reading)

## Citation

```bibtex
@misc{autoskill,
  title={AutoSkill: Automatic Video Skill Routing for Long-Video Understanding},
  year={2026}
}
```
