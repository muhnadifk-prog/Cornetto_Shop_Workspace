# Cornetto Shop Workspace

Separate redesign of the stock and sales tracker. Static site, no build command.

## Storage Status

This release supports Supabase email/password login with per-browser IndexedDB as an offline copy. Sign in with the original tracker account and select Activate cloud once to upload this browser's workspace. Data is only cloud-backed after the status says it is synchronized. Back up before changing browsers or clearing website data, especially while changes are pending.

Cloud data uses a separate `cornetto_workspace_v1` table; the original tracker's `app_data` is not modified. Apply `cloud-setup.sql` once as project administrator. Row-level security permits only the signed-in owner to read their row. All writes use an owner-scoped RPC with revision checks, retry identity and a previous-data recovery copy. The browser configuration contains only a public publishable key, never a service-role secret. The Supabase JavaScript SDK 2.117.2 is vendored as `supabase.min.js` (MIT).

Changes are sent after local saving and retried when connectivity returns. Other devices check for updates on focus and every 30 seconds. Conflicting edits stop synchronization and retain the local copy; choosing cloud data downloads a local backup first. Do not clear browser data or log out with pending edits. A cached workspace is hidden when signed out, but local storage is not encrypted: use a trusted device/OS account.

No customer data, financial records, credentials, or real backup files belong in this repository. Import backups through Data & backup in the deployed browser. Never upload a backup to GitHub.

## Migration

Accepts original stock-tracker v5 JSON or this application's version 1 backup. Imports replace the local workspace only after review, retain a pre-import recovery backup, and preserve the original archive including invoice attachments. Reimport of the same file is blocked. Imported settlement status and missing purchase payment sources remain unknown. Negative stock is preserved and flagged. Card balances cover recorded business purchases/payments, not complete bank statements. Tax eligibility defaults unverified.

## Shared Limits

Workspace backups now use version 2 with `cardGroups`; version 1 imports remain accepted. Run the matching RPC upgrade before publishing this version. The server prevents version 1 clients from overwriting version 2 data, so refresh older open tabs before editing.

Cards retain their own transactions and due-date rules. A group contributes its limit once to totals, and stock purchases check the combined balance of every member, including archived cards and unallocated historical records. Splitting an aggregate bank record preserves its transaction IDs in a non-spendable legacy member instead of guessing their card allocation. New card members start with no transactions. Group/card names and balances are private workspace data, not repository configuration.

## Card Due Dates

Each card may use a manual due date or a monthly statement day (1-31) plus a calendar-day offset (1-60). Short months clamp the statement day to their last day; leap years and year boundaries use UTC calendar arithmetic. Scheduled cards display the next due date, including today. This schedule does not establish statement balances, clear unpaid debt, or apply bank holiday adjustments. Existing cards retain their manual dates until a rule is explicitly saved. Schedule fields are included in backups and cloud snapshots.

## Deployment

Import this repository into a NEW Vercel project using Other as the framework, no build command, and the repository root as output. Do not link to the original tracker project.

