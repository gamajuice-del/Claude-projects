# Context-First Video Generation (CFVG)

*Design proposal, draft 1*

> **The reference defines the world. The text defines what happens in it.**
> The model generates footage that feels like it came from the same source. It does not edit the footage it was given.

---

## 1. The problem

Video models today take visual references in three ways. None of them does what CFVG wants.

| Existing approach | What the reference controls | Why it falls short |
|---|---|---|
| Image-to-video (first-frame conditioning) | The opening frame | It copies the composition and only continues the scene. It knows nothing about motion, physics or camera behaviour. |
| Video-to-video editing | Structure, motion and layout | It replicates the source and changes its surface. The events stay the same. |
| Style / identity adapters (IP-Adapter-like) | Appearance statistics | They capture how frames look, not how the footage behaves: timing, physics, camera, compression. They are also optional and weakly weighted next to the text. |

CFVG treats the reference as the **primary prompt**. A single image cannot carry most of what makes footage feel authentic, because that identity is temporal: how characters accelerate, how the camera lags behind the player, how often frames drop, how the codec smears during fast motion. So the reference has to be **video**, and conditioning on it has to be **mandatory**.

## 2. What counts as context

The whole design depends on separating **context** (what to keep) from **content** (what to discard). Context is anything that would stay the same across independent recordings from the same source.

| Context (extract and keep) | Content (do not reproduce) |
|---|---|
| Rendering: shading model, texture filtering, polygon budget, lighting, palette, line art | The particular events that happen |
| Assets: characters, props, UI and HUD elements, typography | The particular composition and framing of shots |
| Physics: gravity, friction, jump arcs, collision response | The particular route or level section shown |
| Animation: frame timing, easing, smears, interpolation, animation-cycle length | The particular sequence of actions |
| Camera: rig behaviour, follow lag, collision handling, lens, shake | |
| Atmosphere: fog, ambient effects, time of day, mood | |
| Recording: resolution, frame rate, aspect ratio, compression artifacts, capture-card noise, scanlines | |

One subtlety: **assets are context**. In the Mario 64 example, Mario himself, the HUD and the level geometry style are part of the world, so the model should render them. What it must not reproduce is the specific playthrough in the reference. The rule is "keep the world, replace the events", which is different from "avoid anything that appears in the reference".

## 3. Architecture

```
 reference clips (1..K)          text instruction
         │                              │
   ┌─────▼──────┐                 ┌─────▼──────┐
   │ Video VAE  │                 │ Text enc.  │
   └─────┬──────┘                 └─────┬──────┘
   ┌─────▼──────────────┐               │
   │ Context Encoder    │               │
   │ (set transformer   │               │
   │  over all clips)   │               │
   └─────┬──────────────┘               │
   ┌─────▼──────────────┐               │
   │ Context Bottleneck │  N context    │
   │ (Perceiver-style   ├──tokens──┐    │
   │  resampler)        │          │    │
   └─────┬──────────────┘          │    │
         │ shuffled detail tokens  │    │
         ▼                         ▼    ▼
   ┌──────────────────────────────────────────┐
   │ Video Diffusion Transformer (flow match) │
   │  per block: self-attn → context x-attn   │
   │             → text x-attn → MLP          │
   └──────────────────┬───────────────────────┘
                      ▼
               generated video
```

### 3.1 Context Encoder

- It shares the generator's video VAE, so it sees the same latent space it conditions.
- It is a **set encoder** over K reference clips that is invariant to clip order. More clips sharpen the context estimate, much like averaging noisy samples. At inference you can supply one clip or twenty.
- It produces a fixed set of **N context tokens** (for example 256) through a Perceiver-style resampler. The bottleneck is deliberate: the generator can only reach the reference through it, so it cannot copy reference pixels or trajectories token by token.

### 3.2 Two pathways for fidelity without copying

A tight bottleneck loses fine detail such as HUD fonts, texture grain and dithering patterns. CFVG adds a second, controlled pathway:

- **Global context tokens** (the bottleneck) carry the abstract identity: physics, camera, animation and atmosphere.
- **Shuffled detail tokens.** These are patch tokens sampled from the reference, with spatial positions randomly permuted and temporal order destroyed. This keeps local texture and appearance statistics but removes composition and events, so the model can look up what a surface looks like without learning where things were or what happened.

### 3.3 Generator

- A standard video diffusion transformer trained with a flow-matching objective.
- Every block has **two separate cross-attentions**, ordered context first and text second. This reflects their roles: context is the base and text is a modification.
- **No null-context training.** Text-only CFG drops the condition about 10% of the time. CFVG never drops the reference entirely, because the reference is not optional. For guidance it drops only *partial* context (fewer clips, a weakened bottleneck), which gives a usable "context strength" direction.

### 3.4 Guidance

There are two guidance scales, as in InstructPix2Pix:

```
ε̂ = ε(z, c_weak, ∅)
  + s_ctx  · [ε(z, c, ∅)  − ε(z, c_weak, ∅)]
  + s_text · [ε(z, c, t)  − ε(z, c, ∅)]
```

- `s_ctx` sets how strongly the output must feel like the source.
- `s_text` sets how strongly the instruction is followed.
- `c_weak` is a degraded context, never an empty one.

### 3.5 Text overriding context

"A mod where Mario is gigantic" changes one attribute of the world. The rule is:

> **The reference defines the default value of every attribute. The text overrides only the attributes it explicitly names.**

This needs its own training data (section 4.4). Without it, the model either ignores the override because context wins, or lets the override spread: a giant Mario with suddenly modern rendering.

## 4. Training

### 4.1 Context groups

The basic training unit is a **context group**: a set of videos that share a source but were **recorded independently**.

| Source of groups | Shared context | Independence comes from |
|---|---|---|
| Gameplay | Same game and platform | Different sessions, players, levels |
| Animation | Same show or studio era | Different episodes and scenes |
| Live action | Same camera body, lens, film stock, era | Different shoots |
| Broadcast / home video | Same channel, format, tape type | Different broadcasts |
| AI-generated video | Same model and version | Different prompts and seeds |
| **Synthetic engine** (4.5) | Exact known parameters | Procedurally different scenes |

**Mining.** Candidate groups come from metadata (game title, channel, show, EXIF, model name) and are refined by embedding clustering. Clips **within** a group are then filtered so they really are independent. A pair is rejected if it is a near-duplicate (perceptual hashing), shows the same event (scene matching, overlapping timestamps from the same upload) or is a re-upload. If two clips show the same event, the training signal teaches copying, which is exactly the failure CFVG exists to avoid.

### 4.2 The core objective

```
sample a context group G
R  ← 1..K clips from G                 # references
y  ← one clip from G \ R               # target, independently recorded
t  ← event_caption(y)                  # describes WHAT HAPPENS, not how it looks
loss = flow_matching_loss(generator, y | context(R), t)
```

This is the central idea of the proposal. **The objective enforces "feel like, don't replicate" by construction.** The target's events differ from the references' events, so copying the reference cannot lower the loss. The only way to predict `y` is to infer the world from `R` and the events from `t`.

**Context-stripped captions.** The caption model is told to describe events only ("the character runs up a hill, jumps onto a moving platform and collects an item"). It must not use style or source words like "N64", "low-poly", "VHS" or "Pixar-style". If captions name the context, the model learns to read the context from the text and ignores the reference.

### 4.3 Context Encoder pretraining

Before joint training, the encoder is pretrained so that its tokens capture context and discard content:

- **Group contrastive loss.** Clips from the same group are positives and clips from other groups are negatives. Augmentations are limited to temporal crops and short-clip subsampling. Colour jitter, rescaling and re-encoding are excluded because they **change** the context (palette, resolution, compression).
- **Content-adversarial head.** A head behind a gradient-reversal layer tries to predict the event caption from the context tokens. The encoder is trained to make that impossible, which pushes event information out of the context representation.
- **Hard negatives.** These share content but differ in context: an original game against its remaster, the same scene shot on two cameras, the same prompt in two AI models. They teach the encoder that matching layout or events does not mean matching context.

### 4.4 Override training

To teach text-over-context precedence, CFVG uses groups that contain **controlled variants**:

- Game mods and settings toggles, with captions that state the change ("the player character is much larger than normal").
- Synthetic-engine renders where exactly one parameter changes and the caption names it.
- Counter-examples where the caption names nothing, and the context must be reproduced unchanged.

### 4.5 Synthetic engine

A procedural renderer generates groups whose context is **known exactly**. It randomizes shader model, palette, polygon budget, gravity, friction, jump physics, camera rig, frame rate, resolution and compression. This serves three purposes:

1. **Ground-truth disentanglement.** Context and content are separable by construction.
2. **Measurable physics transfer** (section 6). If the reference has low gravity, the generated jump arcs should have low gravity too, and that can be measured.
3. **Breadth for zero-shot.** It provides an unlimited supply of distinct contexts that no real dataset contains.

### 4.6 Post-training with rewards

After supervised training, a reward-based fine-tuning stage (preference optimization or RL on the sampler) optimizes three signals at once:

| Reward | How it is measured |
|---|---|
| **Contextual fidelity** | A *same-source discriminator* trained on group membership, so it asks "were these recorded from the same source?". It is trained with the content-adversarial setup so it cannot score by event overlap. |
| **Originality** | A penalty on similarity to the references in *content space*: nearest-frame layout similarity, optical-flow trajectory similarity, and event-caption similarity between output and reference. It is a **hinge**: it only fires above a copying threshold, so the model is not paid to be strange. |
| **Instruction following** | A VLM judge that answers questions generated from the instruction ("Is the character larger than the surrounding buildings?"). |

Originality is a constraint, not something to maximize. Once the output stops copying, more novelty earns nothing.

### 4.7 Curriculum toward zero-shot

The model is trained as a **meta-learner**, with each context group treated as a separate task:

1. Synthetic contexts only, to learn the disentanglement mechanics.
2. Large real-world groups with many clips per group.
3. Long-tail groups with few clips, where K is small and inference must be confident.
4. Throughout, **entire sources are held out**: whole games, engines, studios and AI models never seen in training. These are the only honest measure of zero-shot ability.

The thing that generalizes is not knowledge of any one game. It is the skill of **inferring a world from footage**, and that skill gets better with the number of distinct contexts in training, not with the number of hours.

## 5. Inference

```python
ctx = cfvg.encode_context([ref_clip_1, ref_clip_2, ref_clip_3])  # cache and reuse
video = cfvg.generate(
    context=ctx,
    prompt="Gameplay of a mod where the main character is gigantic",
    context_strength=4.0,   # s_ctx
    text_strength=6.0,      # s_text
    duration_s=10,
)
```

- The context is encoded once and can be reused for any number of prompts.
- More reference clips give a better estimate. Varied references (different levels, lighting, actions) work better than many similar ones, because variety shows the model what *stays the same*.

## 6. Evaluation

| Metric | Question it answers |
|---|---|
| **Group-FVD** | Is the output distributed like the *held-out* clips of the same group? This is computed per context, against clips the references did not include. |
| **Source Test** (human) | Raters see the references plus two clips, one real held-out clip and one generated clip, and pick which was "recorded from the same source". 50% means indistinguishable. |
| **Copy rate** | How often does the output exceed a content-similarity threshold against any reference clip? |
| **Physics recovery** | On synthetic contexts, physics parameters (gravity, friction, frame rate) are regressed from the generated video and compared with the reference's true values. |
| **Override precision** | Did the requested attribute change while all other attributes stayed matched to the reference? |
| **Instruction score** | VLM question-answering against the prompt. |
| **Zero-shot gap** | The difference on every metric above between contexts seen in training and held-out sources. This is the headline number. |

## 7. Known limitations and open questions

- **Exact fidelity is not guaranteed.** The bottleneck that prevents copying also limits detail. Precise UI text, specific sound-synchronized timing and rare visual effects may come out approximate.
- **Context that only shows through content.** If the references never show water, the model has to *guess* how this world renders water. The guess should be plausible for the context, but it is still a guess.
- **Narrow references.** A single short clip may not separate what is constant from what is incidental, for example whether the fog belongs to the game or to that one level. Supplying several varied clips mitigates this.
- **Ambiguous overrides.** "Make it look modern" touches every context attribute at once, so the precedence rule from 3.5 gives no clear answer. CFVG works best with targeted instructions.
- **Imitating other generative models.** A Sora-style reference carries that model's characteristic artifacts as context. CFVG can approximate this identity, but how closely is an empirical question.

## 8. Responsible-use considerations

A system built to produce footage that "feels authentically recorded" from a specific source creates obvious risks, and the design should address them from the start:

- **Provenance.** All outputs carry a watermark and C2PA-style provenance metadata. The same-source discriminator from 4.6 can be repurposed as a detector.
- **Real people and real events.** References showing identifiable real people, or news and documentary footage, need stricter handling, because context-faithful synthesis of those sources is effectively a deepfake capability.
- **Intellectual property.** Contexts such as a specific commercial game's assets and characters belong to their rights holders. Deployment decisions, training-data licensing and output policies need to account for this. The Mario 64 example illustrates the capability; it is not a recommendation to ship it.
- **Third-party model terms.** Imitating another AI model's output may conflict with that model's terms of use.

## 9. Relationship to prior work

- **Per-game world models** (GameNGen for DOOM, Genie-style models) learn one environment, or a family of them, through dedicated training. CFVG aims to infer the environment **from reference footage at inference time**, with no training on that environment.
- **Reference adapters** (IP-Adapter and similar) make conditioning optional and appearance-only. CFVG makes it mandatory and temporal, covering physics, camera, animation and recording.
- **Video editing / V2V** keeps the source's events and replaces its surface. CFVG does the opposite: it keeps the surface and its behaviour, and replaces the events.
- **Few-shot / in-context generation** puts reference tokens directly into the sequence, which makes copying easy. CFVG routes the reference through a bottleneck and shuffled detail tokens, and trains with independent targets so that copying never pays.

## 10. A minimal first experiment

The cheapest test of the core claim uses no real-world data:

1. Build the synthetic engine (4.5) with around 10k randomized contexts.
2. Train a small CFVG model at 64×64 resolution on 2-second clips, holding out 10% of contexts.
3. Measure **physics recovery** and **copy rate** on the held-out contexts.

If held-out gravity and frame rate are recovered from the references, and copy rate stays low, the training objective is teaching context inference rather than memorization. Everything else in this proposal builds on that result.

**Status.** A CPU-scale version of this experiment (16×16 clips, 8 frames, 3M parameters) is in
[`experiments/`](experiments/README.md). It supports the core claim that training on independent targets
is necessary: replication training lands at wrong-world fidelity and ignores overrides. It does not yet pass the
physics-recovery test, because generated objects are not sharp enough for their behaviour to be read,
and it does not extrapolate gravity beyond the training range.
