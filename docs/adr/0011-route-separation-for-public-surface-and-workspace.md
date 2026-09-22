# 0011. Separation of Public Surface, Application Workspace, and Authentication Routes

## Status
accepted

## Context and Decision
Previously, the root path (`/`) served both as an unauthenticated login/signup modal card and the authenticated dashboard workspace, toggled in-place based on the user's active session. To provide a comprehensive public editorial landing page introducing SQL Backups, its supported database engines, and backup inspection features, we separated the routes into three dedicated paths:
1. `/` serves as the public marketing landing page (Public Surface).
2. `/dashboard` serves as the authenticated control plane (Application Workspace) containing Database Explorer, Backups, and Schedules.
3. `/login` serves as the dedicated, focused authentication gateway supporting both login and account registration.

## Considered Options
1. **In-place root toggle**: Render the landing page on `/` for guests and the dashboard on `/` for authenticated sessions. Rejected to ensure clear separation of concerns, persistent deep links, and predictable browser history.
2. **Modal overlay on `/`**: Keep the auth form inside a modal on the landing page. Rejected in favor of a dedicated `/login` route that provides a focused sign-in experience and simplified URL routing.
3. **Route separation (Selected)**: `/` for the public editorial landing page, `/dashboard` for the application workspace, and `/login` for authentication.

## Consequences
- Unauthenticated requests to `/dashboard` redirect to `/login`.
- Authenticated requests to `/login` redirect to `/dashboard`.
- Visitors navigating to `/` view the public editorial landing page, with top navigation dynamically presenting "Go to Dashboard" when a session is active.
- Top navigation and CTA links consistently direct unauthenticated visitors to `/login`.
