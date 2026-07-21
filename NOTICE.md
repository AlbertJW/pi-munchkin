# Third-party notices

This project is MIT-licensed (see `LICENSE`). It builds on / includes the following
MIT-licensed third-party software:

## Vendored

- **pi-subagent** — `harness/vendor/pi-subagent/`
  Copyright (c) 2026 Michael Jakl. MIT License.
  Source: https://github.com/mjakl/pi-subagent
  The original license is preserved verbatim at `harness/vendor/pi-subagent/LICENSE`.

## Peer dependency (not bundled)

- **pi / pi-coding-agent** (`@earendil-works/pi-coding-agent`)
  Copyright (c) 2025 Mario Zechner. MIT License.
  Source: https://github.com/earendil-works/pi
  The harness extensions here import from this package; install it separately.

## Runtime prerequisite (not bundled)

- **Ketch** — public web search and extraction CLI
  Copyright its contributors. MIT License.
  Source: https://github.com/1broseidon/ketch
  The harness invokes Ketch as an external executable; no Ketch source or binary is bundled.
