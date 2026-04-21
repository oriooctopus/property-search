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

## Dev Server

The dev server runs on port **8000** (`http://localhost:8000`), not the Next.js default of 3000. Always use port 8000 when linking to local pages.

## Deployment

Production URL: **https://dwelligence.vercel.app**

Vercel auto-deploys on push to `main`. Always use this URL when referencing the live site (not the auto-generated `web-seven-chi-63.vercel.app`).

## MANDATORY: Typecheck Frequently

Run `cd web && npx tsc --noEmit` at these checkpoints — not just before push:

1. **After every implementation agent completes** — before reporting "done" to the user, before spawning verify.
2. **Before every `git commit`** — especially when committing changes that span multiple files or touch shared types.
3. **Before every `git push`** — always. Production deploy failures from tsc errors are unacceptable because they were catchable locally.
4. **When the user says "deploy"** — before pushing, run tsc even if you think nothing changed; the working tree may have drifted.

If tsc reports errors, stop and fix them before proceeding. Never push with failing tsc. Never assume "the agent said it was clean" — re-run it yourself. The cost of running tsc is ~5 seconds; the cost of a broken production deploy is much higher.

If tsc errors appear in files you did not touch, investigate — they may be pre-existing but also may block your push. Surface them to the user loudly before deciding how to unblock.

## MANDATORY: Always Follow Up on Deployments with a Background Agent

After every `git push` to `main` (or any push that triggers a Vercel deploy), immediately spawn a background agent to monitor the deployment. Never consider a "deploy" done just because the push succeeded — the deploy itself must succeed.

The follow-up agent must:
1. Poll Vercel (via the Vercel MCP: `mcp__vercel__getDeployments` / `mcp__vercel__getDeploymentEvents`) until the deployment reaches a terminal state (`READY`, `ERROR`, or `CANCELED`) — with a timeout of ~5 minutes.
2. If `READY`: hit the production URL with a curl or Playwright check to confirm it actually responds 200 and the new change is visible.
3. If `ERROR` or `CANCELED`: pull the build events log, extract the root cause (tsc error, lint error, runtime crash, etc.), and report back with the exact file/line and error message. Never just say "deploy failed" — always surface the specific error.
4. Report back to the main conversation with: deploy status, deploy URL, commit SHA built, verification result, and (if failed) the exact error + suggested fix.

This is not optional. Production-broken-and-we-didn't-notice is worse than any other class of bug. Launch this agent via `run_in_background: true` immediately after every push, in the same response where you confirm the push.

## MANDATORY: Push and Deploy Frequently

Commit and push after every batch of verified changes — don't accumulate a large backlog of uncommitted work. The user wants to see changes deployed to production quickly. After a few related fixes are verified, proactively suggest pushing. Smaller, more frequent deploys are always better than one big push at the end.

## Test Credentials

Test account credentials are in `web/.env.local` (not committed). Use these for Playwright-based verification of authenticated features like AI search, favorites, and would-live-there.

## Core UI Components

All interactive elements must use the composable button system in `web/components/ui/`. Never create inline buttons with raw style props or ad-hoc hover handlers.

- **ButtonBase**: Foundation for all buttons. Provides cursor-pointer, transitions, focus ring, disabled state.
- **Variants**: IconButton, ActionButton, FilterChip, PillButton, TagButton, PrimaryButton, TextButton
- **Hover states**: Use Tailwind data-attribute patterns, never onMouseEnter/onMouseLeave inline style mutations
- **New buttons**: Always compose from ButtonBase. If an existing variant fits, use it. If not, create a new variant that composes ButtonBase.
- **Consistency**: All clickable elements must have cursor-pointer, transition-colors duration-150, and visible focus states.
