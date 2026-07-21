# Security policy

## Supported version

Security fixes are applied to the latest published minor release. The current supported line is 0.3.x.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue with exploit details, credentials, private model endpoints, or local filesystem paths. Include the affected version, platform, reproduction steps, and expected impact.

## Trust boundaries

pi-munchkin runs inside the pi coding-agent process and can observe tool calls and local paths. Review the enabled extension list before installation, install only from this repository or the npm package named `pi-munchkin`, and keep credentials outside tracked configuration files. The release package deliberately excludes the benchmark-only `chaos` fault injector.

The default-on `ketch` extension invokes an external search helper for public web research; set `KETCH=off` for offline/private sessions. It applies a **best-effort** public-URL preflight (rejecting loopback, private, and credentialed destinations and validating the redirect hops it can observe), bounds results, and starts Ketch with a reduced child environment that does not inherit model-provider credentials. The preflight is not an end-to-end SSRF guarantee: Ketch performs its own DNS resolution and fetch, so protection against DNS rebinding and Ketch-side redirects depends on Ketch's own hardening. Ketch itself is an external prerequisite and the package does not bundle credentials or binaries.
