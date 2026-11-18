# AI Workspace 0.7.0: User and developer guide

AI Workspace is a personal Windows application with GPT as the conversational supervisor and DeepSeek as the development executor. The application interface remains in Chinese. This English guide describes the corresponding controls by their meaning.

## Install and connect

1. Close the previous application window before running the Windows x64 installer.
2. Open account settings, use the official Continue with ChatGPT authorization flow, and select an available GPT model.
3. Start a conversation with GPT. Ordinary conversation requires neither a DeepSeek key nor a project folder.
4. To execute development tasks, save your own DeepSeek API key in settings and select the project folder.
5. Explicitly ask GPT to create or modify the project. Discussion alone does not start execution.

Enter credentials only in the application settings or the official authorization page. Do not post passwords, API keys, cookies, or authorization URLs in chat or issues.

Upgrades retain the existing local settings, history, and restore points. Paused tasks do not automatically restart.

## Collaboration and task control

GPT handles conversation, requirements, questions, planning, delegation, supervision, and acceptance. It can write critical designs or code for DeepSeek to apply and test.

DeepSeek operates through project-scoped tools. The local engine validates requests, applies permissions, records operations, and recovers from interruptions.

The main chat displays user and GPT messages. Expand execution details to inspect DeepSeek responses, tool calls, command output, and reviews. Long logs scroll within their own panel.

Only one development task executes at a time. Other tasks queue. Total task time, rework count, and DeepSeek spending have no configured cap. Missing information, permissions, account allowance, or non-retryable errors can still pause work.

Close the application or suspend the computer to pause and save. Resume explicitly after reopening.

## Questions, requirements, and progress

GPT can display multiple-choice questions with custom-text answers. Partial answers are saved locally. Confirming a requirement checklist does not itself authorize development or approve important operations.

Stage cards distinguish accepted work from requested rework. Accepted steps do not establish whole-task completion: GPT must review the complete goal and actual verification evidence.

Progress reflects real activities and accepted steps rather than a fabricated time estimate. Approval requests remain visible even when execution details are closed.

## Model and reasoning settings

GPT and DeepSeek models and reasoning efforts are independently selectable and remembered per model. Pause active work before changing them.

Unsupported selections are rejected rather than silently reduced. Higher effort can increase latency and usage. These are this application's settings; they do not modify the official ChatGPT app's settings or expose internal reasoning transcripts.

If official ChatGPT authorization or plan allowance becomes unavailable, progress is preserved. There is no automatic fallback to a separately billed OpenAI API account or account rotation to evade limits.

## Embedded browser

Open the web-preview tab for the selected project. A wide window can display chat and preview side by side.

- Open static HTML directly.
- Use build-and-preview for a frontend project with a build script.
- Configure a project-relative preview directory and entry file when needed.
- Reload, capture screenshots, switch desktop/mobile dimensions, and inspect page messages.
- AI tools can observe elements, click, fill test content, select options, scroll, take screenshots, and assert actual content or input values.

A screenshot alone does not pass acceptance. Assertions must match the current project files, and page script errors prevent successful browser verification. Build-based previews must be rebuilt when their recorded build fingerprint becomes stale.

Screenshots are saved locally and submitted to GPT, and to the selected DeepSeek model when its image support is verified. The live image checks for this release used gpt-6.1-sol and deepseek-flash. Unverified DeepSeek models use page text and elements; your model choice is not automatically changed.

The preview uses a temporary isolated session. It does not inherit application accounts or the workspace bridge. Public resource reads are allowed; other local/private services, computer files, downloads, file selection, external navigation, iframes, and public write requests are restricted.

### Current browser limits

Version 0.7.0 supports static pages and built frontend assets. It does not host backend servers, local databases, local APIs, server-side rendering, or development servers for full-stack acceptance.

A task requiring those services must identify what remains unverified. General mouse/keyboard control of other Windows applications is outside this release's scope.

## Permissions, files, and commands

The selected project directory is the default file boundary. Paths are checked for traversal, protected locations, links/junctions, reserved device names, and alternate data streams.

File modifications create restore points. Existing-file deletion requires approval. Project dependencies may be installed automatically; additional folders, system development tools, system changes, uploads, and publication require approval.

Ordinary commands run in a Windows AppContainer copy of the project. Checked file changes are synchronized afterward, with separate approval for deletions. Interrupted copies are not treated as completed output.

If another editor changes the original project during execution, synchronization stops to protect those changes. Operations with unknown outcomes are not blindly replayed after interruption.

Long-running commands return job identifiers. The executor must collect final output and exit codes or stop a stalled command before proceeding.

Installed Node.js/npm, Python, Git, PowerShell, and .NET are supported. Runtime copies can require extra disk space and a slower first invocation.

Ordinary commands cannot use the network. Dedicated dependency-install tools provide networking: npm disables lifecycle scripts, and pip installs binary packages into the project's .aiw-python directory. Other system requirements may need user intervention.

Supported system-tool installation requests use Windows Package Manager and explicit approval. Windows can also display its own permission prompt.

## Connection recovery

Network, rate-limit, service, protocol, parameter, balance, certificate, and output-limit failures are classified separately.

Retryable failures use delays of 1, 4, 10, 30, and 60 seconds, then at least 60 seconds, while respecting Retry-After. Pausing cancels future retries.

Header waiting and stream-idle waiting have separate deadlines. Stream activity and keep-alive data extend the idle deadline. Partial tool calls are never executed.

Non-retryable failures preserve progress and explain the problem. Output limits can trigger GPT supervision to split work or use anchored edits instead of repeatedly generating the same incomplete output.

## Accounts, local data, and usage

ChatGPT uses the official Sign in with ChatGPT DevKit. It does not scrape cookies, request account passwords, or read another application's login files.

Authentication, registration, consent, refresh, and credential-storage source are unchanged. Marked response-type/serializer extensions add reasoning effort, strict schemas, refusal handling, and inline image input.

Credentials use Electron safeStorage on Windows. The renderer receives status rather than saved tokens or keys.

Application records, encrypted credentials, caches, and restore points are stored under %APPDATA%/AI Workspace. Upgrades retain that location; uninstalling does not remove it by default.

Local records are not the same as offline execution: required prompts, code, tool output, and screenshots are submitted to the corresponding model provider.

DeepSeek charges follow the provider's billing. Returned token usage is displayed, and optional manually entered prices can provide estimates. Interrupted calls may lack full usage results. Manage ChatGPT plan allowance through official account settings.

## Common controls

| Shortcut | Action |
| --- | --- |
| Ctrl+N | New conversation |
| Ctrl+K | Search titles |
| Ctrl+B | Toggle the sidebar |
| Ctrl+, | Account settings |
| Esc | Close settings or development details |
| Enter | Send |
| Shift+Enter | New line |

Conversations can be renamed and exported. Task files can be edited or restored after pausing. Manually changing a completed task's files requires another acceptance check.

## Build and test

Keep the repository layout. Requirements include Windows x64, Node.js 22.12 or a compatible newer version, and the Windows .NET Framework C# compiler.

~~~powershell
cd outputs/AI-Workspace
npm ci
npm run typecheck
npm run build
npm start
~~~

Create an installer:

~~~powershell
npm run package
~~~

Output is written to work/final-release at the repository root. If the application folder is moved independently, adjust build.directories.output in package.json.

Default and desktop checks:

~~~powershell
npm test
npm run test:desktop
node scripts/test-polish.mjs
node scripts/test-decisions.mjs
node scripts/test-reasoning.mjs
node scripts/test-cooperation.mjs
node scripts/test-execution-layout.mjs
node scripts/test-preview.mjs
node scripts/test-packaged.mjs
~~~

Set AIW_PYTHON_TEST=1 to enable the installed-Python check and AIW_NETWORK_TEST=1 to enable the public test-dependency installation check. These checks do not install system tools.

Live-model drivers are opt-in, require local authorization, and consume provider usage. Read the selected driver before running it.

~~~powershell
node scripts/run-live.mjs --preview
node scripts/run-live.mjs --cooperation
node scripts/run-live.mjs --reasoning
node scripts/run-live.mjs --questions
node scripts/run-live.mjs --diagnostic
~~~

Preview and cooperation checks use generated test projects. Default tests use controlled model responses rather than paid calls.

## Source map

| Path | Purpose |
| --- | --- |
| src/core/conversations.ts | GPT-first chat and explicit development routing |
| src/core/decisions.ts | Question validation and requirement provenance |
| src/core/engine.ts | Execution, supervision, review, queueing, retries, and approvals |
| src/core/providers.ts | Model connections and settings |
| src/core/deepseek-stream.ts | Stream parsing and diagnostics |
| src/core/tools.ts | Tool definitions, validation, and operation records |
| src/core/files.ts | Boundaries, hashes, writes, and restore points |
| src/core/runner.ts | Isolated execution and synchronization |
| src/core/store.ts | Local SQLite records |
| src/core/preview-server.ts | Preview server and restricted proxy |
| src/preview-manager.ts | Browser preview and automation |
| src/main.ts and src/preload.ts | Desktop process and restricted bridge |
| src/ui/ | Application interface |
| native/SandboxRunner.cs | AppContainer and process-tree isolation |
| vendor/siwc/ | Official authorization component and marked extensions |

## Validation and limitations

See [the validation summary](../../docs/VALIDATION.md).

Windows 11 x64 was tested. A separate Windows 10 machine and complete installation/uninstallation wizard paths have not been exhaustively tested. The installer is an unsigned personal build.

Some Node versions' default test-child mode can stall in the current AppContainer environment. A compatible single-process test-isolation option may be necessary; actual verification modes must be disclosed.

Live synthetic checks establish only the tested behavior. No general GPT-only versus dual-model cost/quality benchmark has been completed.

## License and references

AI Workspace is independently developed and is not affiliated with OpenAI or DeepSeek. The main package retains its existing UNLICENSED marker.

The bundled official DevKit and marked modifications retain the Noncommercial License v1.0. Preserve component licenses, attribution notices, and change records when redistributing them.

- Official integration: https://developers.openai.com/siwc/token-sharing-open-source
- Integration limitations: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- DevKit source: https://github.com/openai/sign-in-with-chatgpt-devkit
- DeepSeek API: https://api-docs.deepseek.com/
