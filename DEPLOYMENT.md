# Deployment Checklist

## 1. Push To GitHub

```bash
git init
git add .
git commit -m "Build config-driven full stack app runtime"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## 2. Deploy Backend

Good options: Render, Railway, or Fly.io.

For Render:

- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  - `DATABASE_URL`
  - `PORT`
  - `APP_CONFIG_PATH` if your host does not preserve the repo folder layout

The backend reads config from `APP_CONFIG_PATH`, then `frontend/config.json`, then `backend/config.json`. For Render with `rootDir: backend`, use `APP_CONFIG_PATH=config.json`.

## 3. Deploy Frontend

Good options: Vercel, Netlify, or Render Static Site.

- Root directory: `frontend`
- Build command: `npm install && npm run build`
- Publish directory: `frontend/dist`
- Environment variables:
  - `VITE_API_BASE` set to your live backend URL

Before deploying frontend, either set `VITE_API_BASE` on the hosting provider or set `apiBase` in `frontend/config.json` to your live backend URL, then run:

```bash
cd frontend
npm run build
```

## 4. Loom Video Points

- Config-driven architecture: `frontend/config.json` controls fields, entity, auth UI, localization, and features.
- Backend generates/migrates PostgreSQL schema from config.
- Generic CRUD routes live under `/api/:entity`.
- Auth uses email/password sessions.
- Data is scoped by `owner_id`.
- Implemented features: localization, CSV import, notifications, mobile-ready UI.
- Edge cases handled: missing fields, unknown field types, validation errors, API errors, empty states.
