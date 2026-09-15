# Recorded runs

The four runs the guide quotes. Each file records the model, which system prompt
and which tool surface produced it, the mean, and every per-case score.

| file | config | overall |
|---|---|---|
| `baseline-part2-tools.json` | Part 2 tools + Part 2 prompt, gpt-5.4-mini | **75%** |
| `final-with-part3-prompt.json` | final tools, Part 3 prompt, gpt-5.4-mini | **99%** |
| `final.json` | final tools + final prompt, gpt-5.4-mini | **99%** |
| `final-on-gpt-4o-mini.json` | final tools + final prompt, gpt-4o-mini | 95% |

Read them in that order and the argument of the week falls out:

- **75% → 99%** is what the tool schema bought (bound arrows 17→100, bound
  labels 37→100, tool choice 79→100).
- **99% → 99%** is what an hour of prompt engineering bought on the aggregate.
  It did move `noOverlaps` from 90% to 100%; everything else was already at the
  ceiling, and a ceiling cannot show you a gain.
- **95%** is the same agent on a cheaper model. Close enough to use, far enough
  apart that a few points measured across a model swap tell you nothing.

All four were re-measured after the `strict` fidelity fix in `runAgent` (see
Part 3 of the guide). Numbers taken before it are not comparable: the eval was
sending a schema production never sent.

Single runs of fourteen cases. Treat anything under five points as noise.
