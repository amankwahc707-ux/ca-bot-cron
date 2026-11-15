# CA Bot Cron

Automated crypto/forex/commodity signal scanner for CA Creative Bot Signals.

Runs every 5 minutes via GitHub Actions, computes signals using 14-gate confluence, and writes them to Firestore for the subscriber bot to consume.

## Architecture

- GitHub Actions cron → runs scan → writes signals to Firestore
- Frontend (subscriber bot) → reads signals from Firestore
- When user is offline → cron runs paper autotrade on their behalf

## Setup

Configured via GitHub Secrets — no local setup needed.
