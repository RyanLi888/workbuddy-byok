# Security policy

Security fixes target the latest published version. Older releases are not maintained separately.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/RyanLi888/workbuddy-byok/security/advisories/new) when available. If it is unavailable, use the repository owner's [GitHub profile](https://github.com/RyanLi888) to locate a private contact channel. A public issue may ask for a private reporting channel, but must not include vulnerability details, exploitation steps, tokens, or personal data.

Include the affected version, platform, impact, and a minimal reproduction using synthetic data. Do not send real API keys, OAuth tokens, account cookies, databases, or unredacted request recordings.

## Local data and network access

The gateway processes provider credentials and model request/response content. Settings and call records are stored locally in `~/.workbuddy-byok`; requests are transmitted to the configured upstream service. Protect this directory and backups with operating-system permissions, and treat installed plugins as executable code.

Use loopback listening and a gateway key when appropriate. Exposing the service to another network requires your own authentication and network protection. Application updater signatures verify update integrity; they do not imply publisher certification or Apple notarization.
