---
name: career-ops-plugin-gmail
description: How to pull job leads from a Gmail label into the career-ops pipeline.
license: MIT
---

# gmail plugin

Reads a Gmail label, extracts clean job URLs from authentic (DMARC-passing)
emails, and returns them as leads. The engine writes them to the pipeline.

## Command

- `node plugins.mjs run gmail` — ingest new leads from the configured label.

## Setup

Put `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` + `GMAIL_REFRESH_TOKEN` in `.env`
(an OAuth Desktop client + a refresh token from the consent flow). Configure the
label + lookback in `config/plugins.yml`:

```yaml
plugins:
  gmail: { enabled: true, label: "Job Leads", days_back: 7 }
```

## Data it produces

`Job[]` ({ title, url, company, location }). The engine de-dups against the
pipeline and appends new ones. A job-board link keeps its posting when the
query carries a tracker key such as `trackingId`. The plugin strips the keys
the tracker already strips.

The processed-message cursor lives in `data/gmail-state.json`, under your data
root. A message id is written when the message has no usable job URL, or after
a lead from it is saved or already in the pipeline. A lead titled
`Job lead (email)` that misses your title filter is named in the skip line and
stays unread. `--dry-run` does not write the cursor.
