# Cornetto Shop Workspace

Separate redesign of the stock and sales tracker. Static site, no build command.

## Storage Status

This release uses per-browser IndexedDB. Cloud authentication and synchronization are NOT connected. Do not treat a successful deployment as a successful cloud migration. Back up before changing browsers or clearing website data.

No customer data, financial records, credentials, or real backup files belong in this repository. Import backups through Data & backup in the deployed browser. Never upload a backup to GitHub.

## Migration

Accepts original stock-tracker v5 JSON or this application's version 1 backup. Imports replace the local workspace only after review, retain a pre-import recovery backup, and preserve the original archive including invoice attachments. Reimport of the same file is blocked. Imported settlement status and missing purchase payment sources remain unknown. Negative stock is preserved and flagged. Card balances cover recorded business purchases/payments, not complete bank statements. Tax eligibility defaults unverified.

## Deployment

Import this repository into a NEW Vercel project using Other as the framework, no build command, and the repository root as output. Do not link to the original tracker project.
