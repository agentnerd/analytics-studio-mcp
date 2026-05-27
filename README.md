# Analytics Studio MCP

Analytics Studio is a minimal MCP App that renders **actual tool-provided data only** as an embedded interactive chart. It is designed for ChatGPT/Claude-style MCP App hosts that support `text/html;profile=mcp-app` resources.

No sample values are rendered in the embedded app. The tool must be called with `rows` or `csv`.

## Features

- Embedded MCP App UI resource: `text/html;profile=mcp-app`
- Actual data only: requires `rows` or `csv`
- Editable chart title
- Chart type icon bar: bar, horizontal, line, area, donut, scatter, heatmap, KPI
- Gear-config panel with labels:
  - Category/X field
  - Metric/Y field
  - Series
  - Filter field/value
  - Palette
- Click chart marks to filter/drill into data
- Removable filter chips
- Light/dark mode toggle
- Minimal, elegant UI inspired by modern Apple-like visual design

## MCP Endpoint

After deployment, use:

```text
https://YOUR-SERVICE-URL/mcp
```

The server supports JSON-RPC MCP methods:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`

## Tool

Tool name:

```text
analytics_studio
```

The tool requires either `rows` or `csv`.

Example arguments:

```json
{
  "topic": "Revenue by campaign",
  "datasetName": "Campaign performance",
  "chartType": "bar",
  "rows": [
    { "campaign": "Search", "revenue": 41000, "orders": 10 },
    { "campaign": "Social", "revenue": 33000, "orders": 8 },
    { "campaign": "Email", "revenue": 26000, "orders": 7 }
  ],
  "xField": "campaign",
  "yField": "revenue"
}
```

## Local Development

```bash
npm install
npm run check
npm start
```

Local server:

```text
http://localhost:8080/mcp
```

Optional port override:

```bash
PORT=4210 npm start
```

## Deploy to Google Cloud Run

Prereqs:

- Google Cloud project
- Cloud Run enabled
- Artifact Registry / Cloud Build permissions
- `gcloud` CLI authenticated

Deploy:

```bash
gcloud run deploy analytics-studio-mcp \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars SERVER_URL=https://YOUR-SERVICE-URL \
  --quiet
```

After the first deploy, Cloud Run prints the service URL. Redeploy with `SERVER_URL` set to that URL.

## Deploy Automatically from GitHub

This repo includes a GitHub Actions workflow at:

```text
.github/workflows/deploy-cloud-run.yml
```

### Required GitHub secrets

Set these in GitHub → Repo → Settings → Secrets and variables → Actions:

- `GCP_PROJECT_ID` — Google Cloud project ID
- `GCP_REGION` — e.g. `us-central1`
- `GCP_SERVICE_ACCOUNT_KEY` — JSON service account key with Cloud Run deploy permissions

Optional variables/secrets:

- `SERVICE_NAME` — defaults to `analytics-studio-mcp`
- `SERVER_URL` — your final service URL. If omitted, the workflow uses the Cloud Run URL after deploy where possible.

### Trigger

The workflow deploys on pushes to `main` and can also be run manually from GitHub Actions.

## Install as a Custom Connector

In an MCP-capable host:

1. Open connector/app settings.
2. Add a custom MCP connector.
3. Name it `Analytics Studio`.
4. Use your deployed MCP URL:

```text
https://YOUR-SERVICE-URL/mcp
```

5. Save/connect.
6. Ask the host to visualize actual data, for example:

```text
Use Analytics Studio to chart this CSV as revenue by campaign: ...
```

If the host opens the app but it says “Waiting for data,” the tool was called without `rows` or `csv`. Ask the host to call `analytics_studio` with the actual rows/CSV.

## Zip Install / Self-Hosting

To share this app as a zip:

```bash
zip -r analytics-studio-mcp.zip . \
  -x "node_modules/*" ".git/*" "*.DS_Store"
```

Recipient install:

```bash
unzip analytics-studio-mcp.zip
cd analytics-studio-mcp
npm install
npm run check
npm start
```

Then deploy to their preferred host. The app must be reachable over HTTPS for hosted MCP connectors.

## Important Notes

- Embedded mode never injects sample data.
- Direct `/api/sample-data` intentionally returns empty rows.
- The MCP resource URI may be versioned to bust host-side UI caches.
- Some hosts cache connector definitions; if stale UI appears, remove/re-add the connector or change the `ui://` resource URI.
