# Property Search

## CRITICAL: Visual Regression Check

Any agent modifying files in `web/components/` or `web/app/` that contain JSX:
1. BEFORE changes: run `npm run test:visual` to capture baseline state
2. AFTER changes: run `npm run test:visual` again
3. If any screenshot diff is detected, the Playwright HTML report opens at `web/playwright-report/index.html`
4. Agents MUST NOT deploy or report UI work as complete until the user has approved the visual diff
5. If screenshots changed, pause and tell the user: "Visual changes detected — please review the diff at `web/playwright-report/index.html`"
6. If the user approves, run `npm run test:visual:update` to accept new baselines
7. If the user rejects, fix the regression before continuing
8. A feature that works but looks broken is NOT done

## CRITICAL: Verify All Work

After every implementation agent completes, spawn the `verify` agent before reporting results to the user. Pass it a description of what the task was supposed to accomplish. Do not tell the user something is done until the verifier confirms it.

## Always Use Agents

Launch all implementation tasks as separate agents via the Agent tool (with `run_in_background: true`) so they are non-blocking. Never do multi-step work inline when it could be parallelized across agents.

## Remind User of Open Threads

When agents complete and the user hasn't acknowledged or acted on the results (e.g., picking a design option, reviewing a fix), gently remind them at the end of your next message. With many parallel agents it's easy to lose track of pending decisions.

## Test Credentials

Test account credentials are in `web/.env.local` (not committed). Use these for Playwright-based verification of authenticated features like AI search, favorites, and would-live-there.

## Core UI Components

All interactive elements must use the composable button system in `web/components/ui/`. Never create inline buttons with raw style props or ad-hoc hover handlers.

- **ButtonBase**: Foundation for all buttons. Provides cursor-pointer, transitions, focus ring, disabled state.
- **Variants**: IconButton, ActionButton, FilterChip, PillButton, TagButton, PrimaryButton, TextButton
- **Hover states**: Use Tailwind data-attribute patterns, never onMouseEnter/onMouseLeave inline style mutations
- **New buttons**: Always compose from ButtonBase. If an existing variant fits, use it. If not, create a new variant that composes ButtonBase.
- **Consistency**: All clickable elements must have cursor-pointer, transition-colors duration-150, and visible focus states.
