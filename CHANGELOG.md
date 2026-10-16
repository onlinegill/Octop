# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2b6] - 2026-10-06

### Privacy & Localization (onlinegill fork)
- 100% English defaults across UI, system prompts, agent onboarding (`BOOTSTRAP.md`), and subagents.
- Purged all region-locked Chinese services (WeChat, WeCom, QQ, Feishu, DingTalk) from channels and gateway adapters.
- Removed domestic IP echo fallback endpoints (`4.ipw.cn` and Tencent cloud metadata) from TLS preflight.
- Replaced Chinese expert libraries with clean English general assistant and defaults.
- Cleaned all domestic platform marketing roles from the subagent library.
- Overwrote `zh.json` locale bundles with English defaults.
- Automated daily upstream sync and sanitization via GitHub script.

### Added
- Agent Mail connector (authorization, mail tools, incoming mail tasks).
- LDAP directory authentication.
- Expert default conversation modes and input bar quick actions.
- Multi-architecture native packaging for macOS (Apple Silicon + Intel), Windows (x64 + ARM64), and Linux.

### Changed
- Updated octop-harness integration to 1.0.1 with forced English language defaults.
- Hardened tool execution permissions and workspace isolation.

### Fixed
- Fixed approval dialog regressions on tool execution.
- Resolved streaming errors and long tool name formatting.
- Corrected storage roots on Windows systems and non-ASCII email headers.
