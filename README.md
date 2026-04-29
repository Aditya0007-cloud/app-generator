# Config-Driven Full Stack App Runtime

This project is a small app generator/runtime. The React frontend reads `frontend/config.json` and renders auth, forms, tables, localization controls, CSV import, and notifications from configuration. The backend reads the same config, creates or migrates the PostgreSQL table for the configured entity, and exposes generic authenticated CRUD APIs.

## Implemented Requirements

- Dynamic UI from JSON config
- Dynamic backend APIs at `/api/:entity`
- PostgreSQL schema creation/migration for configured fields
- Basic email/password authentication
- User-scoped data access through `owner_id`
- Validation and JSON error handling
- Loading and error states in the UI
- Responsive layout
- CSV import
- Event notifications
- Config-driven localization switcher

## Run Locally

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

The frontend calls the backend at `http://localhost:5001`, configured in `frontend/config.json`.

For deployment steps, see `DEPLOYMENT.md`.

## Config

Change `frontend/config.json` to add/remove fields or rename the entity. The React dev/build scripts sync it to `frontend/public/config.json` so the app can fetch it at runtime. On backend startup, missing table columns are added automatically.

Example field:

```json
{ "name": "email", "label": "Email", "type": "email", "required": true }
```

Supported UI field types include `text`, `email`, `password`, `number`, `date`, `textarea`, `select`, and `checkbox`. Unknown field types fall back to text input.
