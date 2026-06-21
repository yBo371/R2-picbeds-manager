# Repository Guidelines

## Project Structure & Module Organization

This is a Cloudflare Pages + Vite TypeScript app for browsing images in an R2 bucket. Frontend code lives in `src/`: `main.ts` handles UI state/API calls, and `style.css` contains global styling. Pages Functions live in `functions/`; route folders map to URLs such as `functions/api/list.ts` for `GET /api/list`, `functions/image/[[key]].ts`, `functions/download/[[key]].ts`, and `functions/delete/[[key]].ts`. Shared function helpers are in `functions/types.ts`. Build output goes to `dist/` and should not be edited manually.

## Build, Test, and Development Commands

- `npm install`: install project dependencies.
- `npm run dev`: start Vite for frontend-only development.
- `npm run check`: run TypeScript validation with `tsc --noEmit`.
- `npm run build`: type-check and build the production frontend into `dist/`.
- `npm run preview`: build, then run local Pages Functions with Wrangler.
- `npm run deploy`: build and deploy `dist/` with Wrangler.

Before local Pages testing, set `bucket_name` in `wrangler.toml` to the target R2 bucket.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Follow the existing style: two-space indentation, semicolons, single quotes in TypeScript, explicit interfaces for API shapes, and small helpers for repeated behavior. Use `camelCase` for variables/functions, `PascalCase` for interfaces/types, and route filenames that match Cloudflare Pages conventions such as `[[key]].ts`. Keep CSS selectors readable, following patterns like `.topbar` and `.brand-mark`.

## Testing Guidelines

No automated test framework is currently configured. For changes, run `npm run check` and `npm run build` at minimum. For function or R2 behavior, also run `npm run preview` and verify listing, preview, download, delete, prefix filtering, search, and pagination against a configured bucket. If tests are added later, place them near covered code or in `tests/`, using `*.test.ts` names.

## Commit & Pull Request Guidelines

This repository currently has no commit history, so no established convention exists. Use concise imperative subjects, for example `Add delete confirmation state` or `Fix R2 key decoding`. Pull requests should include a short summary, commands run, configuration changes such as `wrangler.toml` updates, linked issues when applicable, and screenshots for visible UI changes.

## Security & Configuration Tips

Do not commit R2 access keys or secrets; this app should use the Cloudflare `BUCKET` binding. Treat the delete route as sensitive. Protect private deployments with Cloudflare Access or equivalent controls, especially because `/api/list`, `/image/<key>`, and `/download/<key>` can expose bucket contents.
