# Security policy

## Supported versions

| Version | Security support |
| --- | --- |
| Latest published release | Supported |
| Older releases | Not supported |

Security fixes target the latest published version. Upgrade to the latest release before checking whether a problem still occurs. Older releases are not maintained separately.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/RyanLi888/workbuddy-byok/security/advisories/new). Do not report vulnerabilities in public issues, pull requests, or discussions.

Include the affected version, platform, impact, and a minimal reproduction using synthetic data. Do not send real API keys, OAuth tokens, account cookies, databases, or unredacted request recordings.

## Response expectations

The maintainer aims to acknowledge reports within 3 business days and provide an initial assessment within 7 business days. These are response targets for a community-maintained project, not guaranteed deadlines. If there is no response after 7 business days, follow up in the same private report.

Confirmed reports will be coordinated privately with the reporter, including progress updates, a fix or mitigation, and an agreed disclosure date. Fix timing depends on severity and complexity; there is no fixed resolution deadline.

## Local data and network access

The gateway processes provider credentials and model request/response content. Settings and call records are stored locally in `~/.workbuddy-byok`; requests are transmitted to the configured upstream service. Protect this directory and backups with operating-system permissions, and treat installed plugins as executable code.

Use loopback listening and a gateway key when appropriate. Exposing the service to another network requires your own authentication and network protection. Application updater signatures verify update integrity; they do not imply publisher certification or Apple notarization.
