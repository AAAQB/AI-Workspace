# AI Workspace

A personal AI development workspace for Windows 10/11. GPT handles conversations, planning, delegation, key implementations, and review. DeepSeek executes development tasks under the local scheduler's permissions.

**Current release: 0.7.0.** The application interface remains in Chinese. Repository documentation, release notes, and download filenames are in English.

[Download for Windows](https://github.com/AAAQB/AI-Workspace/releases/tag/v0.7.0) | [User and developer guide](outputs/AI-Workspace/USER_GUIDE.md) | [Validation summary](docs/VALIDATION.md) | [Roadmap](ROADMAP.md)

## Features

- GPT-first conversations; explicit development requests trigger delegation to DeepSeek.
- GPT can contribute critical designs and code, supervise execution, and request rework based on actual evidence.
- Multiple-choice questions, requirement checklists, stage reports, truthful progress, and expandable execution details.
- Project files, restore points, operation approvals, task history, a single-task execution queue, and pause/resume.
- Independent model and reasoning-effort settings for GPT and DeepSeek.
- Embedded previews for static pages and built frontends, including screenshots, console inspection, clicks, form input, mobile viewports, and split chat.
- Classified DeepSeek connection diagnostics, adaptive retries, execution-context compaction, and combined final review.

## Getting started

1. Download the Windows x64 installer from [Releases](https://github.com/AAAQB/AI-Workspace/releases). Close the previous version before upgrading.
2. Open the application's account settings and authorize through the official Continue with ChatGPT flow. Availability depends on the account and the official rollout.
3. Add your own DeepSeek API key when you want to execute development tasks, and select a project folder.
4. Explicitly ask GPT to create or modify the project. Important operations require your approval.
5. Open the web-preview tab to inspect project pages, or use the build-and-preview action for frontend projects.

Enter credentials only in the application settings or the official authorization page. Do not commit them or post them in issues.

## Current scope

Version 0.7.0 previews static pages and frontend build artifacts. Automatic hosting and end-to-end acceptance for backend services, local databases, server-side rendering, and local APIs are planned but not implemented.

The preview restricts other local services, computer files, downloads, external navigation, and public write requests. Development commands run within a project-scoped Windows AppContainer environment. Additional access and important operations require approval.

If ChatGPT authorization or plan allowance becomes unavailable, the application preserves progress. It does not automatically fall back to a separately billed OpenAI API account or use unofficial cookie/password authentication.

## Build from source

Keep the repository layout intact. On Windows, install Node.js 22.12 or a compatible newer version, then run:

~~~powershell
cd outputs/AI-Workspace
npm ci
npm run typecheck
npm run build
npm start
~~~

Build the installer:

~~~powershell
npm run package
~~~

Output is written to work/final-release at the repository root. The first build downloads Electron and NSIS components. The native command runner is compiled using the Windows .NET Framework C# compiler.

Run the default tests:

~~~powershell
npm test
~~~

Optional Python and network-install tests require explicit environment flags. The scripts/live-* drivers are opt-in live-model checks. They use local authorization and consume model allowance or API usage; cloning, installing dependencies, and running default tests do not automatically launch them.

## Repository layout

~~~text
outputs/AI-Workspace/   Application source, tests, build scripts, and vendored components
docs/                  Public documentation and validation summary
work/                  Local build and test output; excluded from Git
~~~

The release page contains the installer, an English-documented source archive, a user guide, and SHA-256 checksums. Account credentials, conversation history, personal projects, runtime databases, and raw local execution records are excluded.

## License and attribution

The main project retains its existing UNLICENSED package marker. Third-party components retain their respective licenses and attribution notices.

The bundled Sign in with ChatGPT DevKit and the marked local response-type/serializer modifications use its Noncommercial License v1.0. See [LICENSE-NOTICES.txt](outputs/AI-Workspace/LICENSE-NOTICES.txt), the [DevKit license](outputs/AI-Workspace/vendor/siwc/LICENSE), and the [local change notice](outputs/AI-Workspace/vendor/siwc/AI-WORKSPACE-CHANGES.txt).

AI Workspace is independently developed and is not affiliated with OpenAI or DeepSeek.
