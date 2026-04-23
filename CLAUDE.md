# Property Search

## BLOCKING: Before Reporting ANY Change as Done

Do NOT tell the user a change is done until ALL of these are true:
- [ ] Verify agent spawned and returned PASS
- [ ] Screenshot/report link included in status table
- [ ] If the verify agent used DOM measurements for spacing/layout, it ALSO took a screenshot and visually confirmed

If the verify agent fails, fix the issue and re-verify. Do NOT report as done with a failing verify.
This is not optional. This is not skippable for "small" changes. TSC passing and build passing are NOT verification.

When adding a new Supabase table that is queried by UI components, add a corresponding
mock entry to `web/tests/fixtures/`. The MockRegistry type enforces this at compile time
for tables in the Database type, but API routes called via fetch() need manual mocking.

## CRITICAL: Layout Quality Checks

Agents must check for these layout issues after any UI change:
- **Fill ratio**: Cards and content should fill at least 80% of their container width. A card floating at 60% width looks broken.
- **Consistent spacing**: Elements should have even padding/margin from container edges. Content butting up against a border with no breathing room is a bug.
- **No orphaned whitespace**: Large empty areas next to undersized content indicate a width constraint issue (e.g., `max-w-sm` when `max-w-lg` is needed).
- **Vertical breathing room**: Content needs padding from section dividers (borders, separators). Minimum 8px gap between content and any horizontal rule/border.

## CRITICAL: Verify All Work

After every implementation agent completes, spawn the `verify` agent before reporting results to the user. Pass it a description of what the task was supposed to accomplish. Do not tell the user something is done until the verifier confirms it.

## BLOCKING: Verify Agents Must Use Playwright Headless + a Dedicated Test Account

When spawning the verify agent (or any agent that logs in to the app), the prompt MUST explicitly instruct:

1. **Use Playwright in headless mode** for browser automation. Do NOT use Claude-in-Chrome MCP (which logs into whatever Chrome session the user has open — that's the user's real account). Do NOT default to whatever credentials happen to be in `web/.env.local` without checking who they belong to.
2. **NEVER use `oliverullman@gmail.com` as the login.** That is the user's real personal account. Any data the verify agent saves (wishlist items, saved searches, hidden listings, preferred destination) will pollute the user's real account. It is the wrong audience.
3. Use the **dedicated test account**: `claude-verify@dwelligence.test` (password and email exposed as `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` in `web/.env.local`). This is a sacrificial account on the `.test` TLD (RFC-2606 reserved, never deliverable) — its saved searches, wishlist, hidden listings, and destination are fair game for verify runs. The real account's credentials are kept under `REAL_USER_EMAIL` / `REAL_USER_PASSWORD_*` for reference only — DO NOT use them in verify runs.
4. If the verify agent ONLY needs to read public state (no login required to test the change), skip login entirely.
5. If a verify agent needs to mutate data to demonstrate something (e.g. favorite a listing, add a wishlist item), it MUST clean up after itself in the same run. No leftover test rows.

This applies to every verify-agent spawn, every project. Repeat the rule explicitly in the spawn prompt — don't assume the agent will infer it.

## MANDATORY: Status Table on Every Response

Every response must end with a compact status table of active work items. Done items drop off. Format:

| Item | Next step |
|------|-----------|
| Feature X | ⏳ Agent running / 🔲 Not started / Description |

When a status table row references a deliverable (file, HTML mockup, screenshot, URL), always include a clickable link. "Done — ready for review" is not enough; include the path or URL so the user can click it directly. This applies to all tables and lists, not just status tables — whenever a file or URL is relevant, link it.

**Verify agent specifically**: when a verify agent completes and produced screenshots or files as evidence, you MUST link every one of them in the status table. Reporting "verified" without linking the proof screenshots is incomplete.

When presenting design options (A/B/C/D):
- If all options are on ONE page: single link like `[Pick A/B/C/D](url)`
- If options are on SEPARATE pages: individual links like `[A](url1) / [B](url2) / [C](url3) / [D](url4)`

Links always go in the **Next step** column, never in the **Item** column. The Item column is plain text only.

## Agent Context Continuity

When multiple agents work on the same topic across iterations (e.g., Facebook Marketplace adapter → test it → fix issues), prefer `SendMessage` to continue the same agent rather than spawning a fresh one. Fresh agents lose all prior context.

When a fresh agent is unavoidable, include in its prompt:
- File paths of code the previous agent created/modified
- Key decisions or findings from the previous agent's result
- Any errors or issues discovered

Do not assume a new agent knows what a previous agent did.

## Always Use Background Agents

Launch ALL implementation tasks, bug fixes, and multi-step work as background agents via the Agent tool with `run_in_background: true`. This is mandatory — never do this work inline in the main conversation. The main conversation is only for planning, coordinating, and reporting results.

- Use `run_in_background: true` on every Agent call for implementation work
- Multiple background agents can run in parallel — launch them together in a single response
- After launching, immediately respond to the user to confirm what's running
- When background agents complete, report results and take next steps

## Remind User of Open Threads

When agents complete and the user hasn't acknowledged or acted on the results (e.g., picking a design option, reviewing a fix), gently remind them at the end of your next message. With many parallel agents it's easy to lose track of pending decisions.

## BLOCKING: Dev Server MUST Run on Port 8000

The dev server runs on port **8000** (`http://localhost:8000`), NOT the Next.js default of 3000. This is non-negotiable.

- `web/package.json` pins the port: `"dev": "next dev --port 8000"`. Do NOT remove the `--port 8000` flag under any circumstances. If you see a dev script without it, that's a bug — fix it.
- Before starting the dev server, confirm the script still has `--port 8000`. If an agent stripped it, add it back before running.
- Never run `next dev` or any other dev command that lets the framework pick a default port. If you need to start dev in a non-standard way, pass `--port 8000` explicitly.
- If you see `localhost:3000` in any URL, screenshot, or log output related to this project, STOP — something launched the wrong port. Kill it (`lsof -ti:3000 | xargs kill -9`) and restart on 8000.
- When linking to local pages in status tables, reports, or messages: always use `http://localhost:8000/...`.
- Never tell the user "dev server is running on 3000" — that's a regression. Fix it silently and report 8000.

## Deployment

Production URL: **https://dwelligence.vercel.app**

Vercel auto-deploys on push to `main`. Always use this URL when referencing the live site (not the auto-generated `web-seven-chi-63.vercel.app`).

## MANDATORY: Typecheck AND Lint Frequently

`next build` runs BOTH `tsc` AND ESLint. Passing tsc alone is NOT sufficient — lint errors (e.g. `@next/next/no-html-link-for-pages`) fail the production deploy even when tsc is clean.

Run BOTH of these at every checkpoint below:

```
cd web && npx tsc --noEmit
cd web && npx next lint
```

Checkpoints:
1. **After every implementation agent completes** — before reporting "done" to the user.
2. **Before every `git commit`** — especially when committing changes that span multiple files or touch shared types.
3. **Before every `git push`** — always. Production deploy failures from either tsc OR lint are unacceptable because they were catchable locally.
4. **When the user says "deploy"** — run both even if you think nothing changed; the working tree may have drifted.

Treat lint **errors** as blockers. Lint warnings (unused vars, missing deps) are OK to push. If unsure whether an issue is error vs warning, read the output carefully — `Error:` and `error` lines block `next build`; `Warning:` lines do not.

If either tool reports problems in files you did not touch, investigate — they may be pre-existing but also may block your push. Surface them loudly before deciding how to unblock.

## MANDATORY: Always Follow Up on Deployments with a Background Agent

After every `git push` to `main` (or any push that triggers a Vercel deploy), immediately spawn a background agent to monitor the deployment. Never consider a "deploy" done just because the push succeeded — the deploy itself must succeed.

The follow-up agent must:
1. Poll Vercel (via the Vercel MCP: `mcp__vercel__getDeployments` / `mcp__vercel__getDeploymentEvents`) until the deployment reaches a terminal state (`READY`, `ERROR`, or `CANCELED`) — with a timeout of ~5 minutes.
2. If `READY`: hit the production URL with a curl or Playwright check to confirm it actually responds 200 and the new change is visible.
3. If `ERROR` or `CANCELED`: pull the build events log, extract the root cause (tsc error, lint error, runtime crash, etc.), and report back with the exact file/line and error message. Never just say "deploy failed" — always surface the specific error.
4. Report back to the main conversation with: deploy status, deploy URL, commit SHA built, verification result, and (if failed) the exact error + suggested fix.

This is not optional. Production-broken-and-we-didn't-notice is worse than any other class of bug. Launch this agent via `run_in_background: true` immediately after every push, in the same response where you confirm the push.

## MANDATORY: Auto-Deploy After Verified Changes

Do NOT wait for the user to say "deploy" or "push". As soon as a change is verified (verify agent PASS + tsc clean), automatically:

1. Commit the change with a descriptive message.
2. Push to `main`.
3. Spawn the deploy-monitor background agent (see below).

Multiple related fixes can be bundled into one commit if they were verified together, but do not let verified work sit uncommitted waiting for user approval. The user has pre-authorized shipping verified changes — treat auto-deploy as the default workflow, not an opt-in action.

Exceptions (ask first):
- The change is on a non-`main` branch the user asked you to preserve.
- Another agent is actively working in the same files (merge conflict risk) — wait for it to finish.
- The work is an explicit plan or draft the user said they want to review before shipping.

Smaller, more frequent deploys are always better than one big push at the end. If multiple fixes are in flight across parallel agents, deploy them as each one lands — don't batch them unless they are genuinely interdependent.

## Test Credentials

Test account credentials are in `web/.env.local` (not committed). Use these for Playwright-based verification of authenticated features like AI search, favorites, and would-live-there.

## Core UI Components

All interactive elements must use the composable button system in `web/components/ui/`. Never create inline buttons with raw style props or ad-hoc hover handlers.

- **ButtonBase**: Foundation for all buttons. Provides cursor-pointer, transitions, focus ring, disabled state.
- **Variants**: IconButton, ActionButton, FilterChip, PillButton, TagButton, PrimaryButton, TextButton
- **Hover states**: Use Tailwind data-attribute patterns, never onMouseEnter/onMouseLeave inline style mutations
- **New buttons**: Always compose from ButtonBase. If an existing variant fits, use it. If not, create a new variant that composes ButtonBase.
- **Consistency**: All clickable elements must have cursor-pointer, transition-colors duration-150, and visible focus states.
