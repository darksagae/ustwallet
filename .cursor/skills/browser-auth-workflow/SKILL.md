---
name: browser-auth-workflow
description: Command "saga" or "run saga" means take over the Cursor IDE browser with full permission to do everything the user can do; user intervenes only for authentication or "prove you're human" checks. Use when the user says "saga", "run saga", "take over the browser", or needs browser automation with login/CAPTCHA handoffs.
---

# Browser Auth Workflow (Saga)

## Command: Saga

When the user says **"saga"** or **"run saga"** (e.g. "saga", "run saga", "saga please"), treat it as a request to take over the Cursor browser and run this workflow. Start by taking full control of the browser and doing whatever task they need; hand off only for auth or human-verification, then continue.

## Purpose

**The agent is in complete control of the browser** and has **full permission** to do everything the user could do in the browser: navigate, click, fill forms, submit, open links, use the site like a human would. The user only steps in when (1) authentication is required (password, 2FA, OAuth), or (2) a "prove you're not a bot" step appears (CAPTCHA, "I'm not a robot"). After the user completes that step, the agent takes control again and continues.

## Grant to Agent

The user grants the agent the same level of access as browser use: **do anything in the browser that a human user can do**. No need to ask permission for normal actions (navigation, form filling, clicking, submitting). The only exceptions are entering the user's secrets (passwords, 2FA codes) and solving human-verification (CAPTCHA, "I'm not a robot")—for those, hand off to the user, then resume.

## When to Apply

- User says **"saga"** or **"run saga"** (primary trigger)
- User asks you to "take over the browser" or "control the browser" for manual work
- Task involves a site or flow that requires login, OAuth, 2FA, or consent
- Task may show "prove you're human" / CAPTCHA / "I'm not a robot" or other anti-bot checks
- User wants you in "complete control" with handoffs only for authentication or bot checks

---

## Workflow

### 1. Take Full Control

1. **Check existing tabs**: Use `browser_tabs` (action `list`) to see open tabs and URLs.
2. **Navigate if needed**: Use `browser_navigate` to open the target URL.
3. **Lock the browser**: Use `browser_lock` so you have full control. Order: navigate → lock → interact. If a tab already exists, lock first then interact.
4. Use `browser_snapshot` before any click, type, or form fill. You drive all actions; the user does not.

### 2. Automate Everything Until Auth or Bot Check

You have **full permission** to do whatever the user could do in the browser. Do all steps that don’t require the user’s secrets or human verification:

- Navigate, click links, open forms, submit (when no password/2FA/CAPTCHA)
- Fill any non-secret fields (e.g. username if provided, search, form data)
- Open new tabs, go back/forward, scroll, interact with the page freely

**Stop and hand off when you reach any of:**

- Password field
- OAuth/SSO consent or "Sign in with…" redirect
- 2FA / one-time code prompt
- **"Prove you're human" / anti-bot checks**: CAPTCHA, "I'm not a robot", "Verify you're not a bot", or any step that blocks the agent because it detects automation
- Any step that clearly asks for user-only input or approval

### 3. Hand Off Only for Auth or Human Verification

The user does **not** drive the flow—they only step in when you hit auth or a bot check:

1. **Do not** type passwords, 2FA codes, complete OAuth, or solve CAPTCHA / "I'm not a robot" yourself.
2. **Unlock** the browser (`browser_unlock`) so the user can interact **only** for this step.
3. **Tell the user clearly**:
   - What they’re seeing (e.g. login form, OAuth consent, CAPTCHA, "verify you're not a robot")
   - To complete that step in the browser (enter password, solve CAPTCHA, click the checkbox, etc.)
   - To reply "done" or "auth complete" when finished.
4. **Pause** and wait for their confirmation. You remain in control of the workflow; they only perform this one task.

### 4. Take Control Back and Finish

When the user says they’ve finished (auth or human verification):

1. **Lock the browser again** (`browser_lock`) so you are back in full control.
2. Take a fresh `browser_snapshot` and continue: finish navigation, form filling, or whatever remains.
3. When **all** browser work is done, call `browser_unlock`.

---

## Browser MCP Usage (Reference)

- **Order**: `browser_navigate` → `browser_lock` → (interactions) → `browser_unlock` when done. If a tab already exists, `browser_lock` first.
- **Before interactions**: `browser_tabs` list, then `browser_snapshot` to get structure and refs.
- **Waiting**: Prefer short waits (1–3 s) and repeated `browser_snapshot` instead of one long wait.
- **Typing**: `browser_type` to append; `browser_fill` to clear and replace (also contenteditable).
- **Scrolling**: For nested scroll containers, use `browser_scroll` with `scrollIntoView: true` before clicking.

---

## Example Flows

**Saga command:** User: "saga" or "run saga — sign me into example.com and open the dashboard." → Agent takes over browser (navigate, lock), goes to site, fills username → **stop at password** → unlock, ask user to enter password and say when done → user says "Done" → agent locks, continues to dashboard, unlocks when done.

**Auth:** Same as above: agent does all navigation and form filling until password/OAuth/2FA, then hand off → user completes → agent continues.

**Bot check:** Agent is in control and a "Verify you're not a robot" or CAPTCHA appears → agent unlocks, tells user to complete the check and say when done → user completes it, says "Done" → agent locks, continues, unlocks when fully done.

---

## Summary Checklist

- [ ] Agent has full control: lock after navigate (or lock first if tab exists); keep control except during auth or human-verification
- [ ] Automate everything that doesn’t require the user’s password/2FA/OAuth or a "prove you're human" / CAPTCHA step
- [ ] At auth or anti-bot check: unlock only so the user can complete that step; tell them what to do and to say when done
- [ ] After "done": lock again, complete remaining steps, then unlock when the workflow is finished
