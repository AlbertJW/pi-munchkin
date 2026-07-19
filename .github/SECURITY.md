# Security policy

## Supported version

Security fixes are applied to the latest published minor release. The current supported line is 0.3.x.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue with exploit details, credentials, private model endpoints, or local filesystem paths. Include the affected version, platform, reproduction steps, and expected impact.

## Trust boundaries

pi-munchkin runs inside the pi coding-agent process and can observe tool calls and local paths. Review the enabled extension list before installation, install only from this repository or the npm package named `pi-munchkin`, and keep credentials outside tracked configuration files. The release package deliberately excludes the benchmark-only `chaos` fault injector.

The `ketch` extension invokes an external search helper when used. Other model and network access is controlled by pi and the user's provider configuration; the package does not bundle credentials.
