# Security policy

## Boundary

The gateway validates and controls HTTP requests sent through it. It is not a sandbox and does not make a probabilistic model authoritative for security decisions. Put authentication and network policy in front of public deployments.

State bodies may contain sensitive information. Audit logging excludes state by default. Enabling state capture is intentionally unsupported in the initial release; use hashes and application-owned encrypted storage instead.

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories. Do not open a public issue for suspected credential disclosure, authentication bypass, or remote denial of service.

Supported line: latest tagged release.
