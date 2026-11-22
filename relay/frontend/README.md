# RELAY frontend

React 19, TypeScript, Vite 8, Tailwind v4, TanStack Query.

```bash
npm install
npm run dev      # http://localhost:5173 (expects the API at http://localhost:8000/api)
npm run build    # type-check + production build
npm run lint     # oxlint
```

Set `VITE_API_URL` to point at a different API (see `.env.example`). Demo accounts are one click away on the sign-in page.

| Route | Who | What |
|---|---|---|
| `/login`, `/register` | everyone | Sign in (with demo accounts) / create an employee account |
| `/` | signed in | Overview: key numbers, inbox preview, recent requests, routing guide |
| `/requests/new` | signed in | New request with live approval-route preview |
| `/requests` | signed in | My requests (approvers can switch to everyone's) |
| `/requests/:id` | signed in | Request detail: route stepper, decision/cancel, activity feed |
| `/inbox` | Manager, Finance, Director, Admin | Approvals inbox with approve/reject |
| `/audit` | signed in (employees see their own) | Audit log dashboard |
| `/admin/workflows`, `/admin/dlq`, `/admin/users` | Admin | Workflow rules editor, failed events, users |

Design and integration decisions: `../docs/assumptions/frontend.md`.
