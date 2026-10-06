# AI HR Recruitment Automation

An n8n-based recruitment screening automation for small HR teams. The project combines Google Workspace, custom Node.js logic, and a DeepSeek-compatible LLM API to reduce repetitive CV screening while keeping the final hiring decision with HR.

> **Project status:** Local portfolio/demo implementation. The local regression, workflow, edge-case, and synthetic end-to-end tests pass. Production deployment and real Google Forms trigger acceptance still require separate validation.

## What Problem Does It Solve?

Manual CV screening is slow and inconsistent. Candidate data can also become difficult to track, duplicate applications may be missed, and HR may not have a reliable audit trail for screening decisions.

## Solution Overview

```text
Google Form
    ↓
n8n screening workflow
    ↓
Drive CV download → CV parsing → mandatory rule check
    ↓
LLM scoring or rule-based fallback
    ↓
High / Medium / Low classification
    ↓
Google Sheets + Audit Log + Gmail notification
    ↓
Low candidates → daily auto-reply workflow after 3 days
```

### Candidate categories

| Category | Score | Action |
|---|---:|---|
| High | 80–100 | Notify HR as a strong candidate |
| Medium | 40–79 | Notify HR for manual review |
| Low | 0–39 | Mark for delayed rejection auto-reply |

## Main Features

- Google Forms application intake.
- Google Drive CV retrieval.
- PDF, DOCX, and TXT parsing.
- Mandatory skill, experience, and education checks.
- DeepSeek-based scoring and enrichment.
- Rule-based fallback when the LLM is unavailable.
- Duplicate protection using candidate email and job position.
- Google Sheets candidate database and audit log.
- Gmail notifications for High and Medium candidates.
- Delayed auto-reply for Low candidates.
- Retry with exponential backoff.
- Local JSON buffer fallback for failed Sheets writes.
- Fail-closed handling for corrupt or unsupported CV files.
- Safe HTML escaping for generated email content.

## Repository Structure

```text
.
├── config/
│   └── .env.template              # Environment variable template
├── n8n-workflows/
│   ├── screening-pipeline.json    # Main screening workflow
│   └── auto-reply-cron.json       # Daily Low-candidate auto-reply workflow
├── scripts/
│   ├── parse-cv.js                # PDF/DOCX/TXT parsing helpers
│   ├── rule-check.js              # Mandatory criteria matching
│   ├── llm-scoring.js             # LLM scoring and fallback logic
│   ├── rule-kategori.js           # Score-to-category mapping
│   ├── dedup-check.js             # Duplicate detection
│   ├── audit-logger.js            # Audit event formatting
│   ├── buffer-manager.js          # Local failure buffer
│   └── start-local.ps1            # Local n8n startup script
├── tests/
│   ├── e2e-test.js                # Script-level integration tests
│   ├── edgecase-test.js           # Edge and worst-case tests
│   └── workflow-smoke-test.js     # Workflow JSON and Code Node checks
└── docs/                          # Architecture, QA, and security reports
```

## Prerequisites

- Windows PowerShell.
- Node.js and npm.
- n8n 2.x; local validation used n8n 2.27.4.
- A DeepSeek-compatible chat completion API.
- Google Cloud OAuth credentials.
- Google Drive, Sheets, and Gmail access.

## Local Setup

### 1. Install dependencies

```powershell
npm install
```

### 2. Create local configuration

```powershell
Copy-Item config\.env.template config\.env.local
```

Fill `config/.env.local` with your own values:

```env
LLM_API_KEY=your_llm_api_key
LLM_API_URL=https://api.deepseek.com/chat/completions
LLM_MODEL=deepseek-flash
HR_EMAIL=hr@example.com
SHEET_ID_DATA_KANDIDAT=your_candidate_sheet_id
SHEET_ID_AUDIT_LOG=your_audit_log_sheet_id
```

Do not commit `.env.local`, API keys, OAuth client secrets, or refresh tokens.

For local n8n Code Nodes, keep these settings enabled:

```env
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
NODE_FUNCTION_ALLOW_EXTERNAL=adm-zip,pdf-parse
N8N_SECURE_COOKIE=false
```

### 3. Configure Google OAuth in n8n

For a local server running on port `5680`, use this authorized redirect URL in the Google Cloud OAuth client:

```text
http://localhost:5680/rest/oauth2-credential/callback
```

If the port changes, update the URL accordingly.

In n8n, create and connect these credentials using the Google account that owns or can access the required files:

- `Google Drive (AI HR)`
- `Google Sheets (AI HR)`
- `Gmail (AI HR)`

The Google OAuth consent screen must include the test Google account when the application is still in testing mode.

### 4. Prepare Google Sheets

The candidate sheet should contain a `Data Kandidat` tab with these headers:

```text
Timestamp, Nama, Email, No HP, Lowongan, URL CV, Rule Check, Alasan Rule Check, Skill Terdeteksi, Skor LLM, Alasan Skor, Enrichment Notes, Kategori, Alasan Kategori, Kategori Label, Status Notifikasi HR, Status Auto-Reply, Waktu Auto-Reply, Error Flag
```

The audit sheet should contain an `Audit Log` tab with:

```text
Timestamp, Event Type, Email Kandidat, Lowongan, Detail, Status
```

### 5. Start n8n locally

```powershell
.\scripts\start-local.ps1
```

Open the URL printed by the script, for example:

```text
http://localhost:5680
```

Import both JSON files from `n8n-workflows/`, then verify the credential names match the workflow references.

## Testing

Run the complete local test suite:

```powershell
npm test
```

Run individual checks:

```powershell
npm run test:e2e
npm run test:edge
npm run test:workflow
npm run syntax:check
```

The test suite covers normal screening, fallback scoring, empty and corrupt CVs, compressed DOCX parsing, malformed model scores, duplicate matching, path traversal protection, HTML injection handling, workflow graph validation, and Code Node syntax.

## n8n Workflow Notes

The screening workflow expects the form response to be mapped to the candidate fields used by the Code Nodes, including candidate name, email, phone number, job position, CV file, criteria, and scoring weights. Confirm this mapping in the n8n UI when connecting a native Google Forms trigger.

The local E2E test uses controlled synthetic input so it can verify the complete processing path without creating real candidate records. A native Google Forms event should be tested separately after the form field mapping and OAuth permissions are confirmed.

## Security and Reliability

- Credentials stay in n8n Credential Store or local environment configuration.
- Secrets are not stored in workflow JSON or source code.
- LLM scores are clamped to a safe 0–100 range and non-finite scores are rejected.
- CV parsing fails closed for corrupt or unsupported files.
- User-controlled email content is HTML-escaped.
- Buffer file access is protected against path traversal.
- External API failures use retry, fallback, audit, or buffer handling.

## Current Validation Status

The current local validation results are:

- Regression tests: **35/35 passed**.
- Edge and worst-case tests: **17/17 passed**.
- Workflow smoke test: **passed**.
- Syntax check: **9/9 scripts passed**.
- n8n health check: **passed**.
- Synthetic DOCX execution through an n8n Code Node: **passed**.

This project is intended as a local portfolio/demo system. It has not yet been presented as a production ATS replacement, and no production deployment or measured HR time-saving KPI is claimed.

## License

ISC
