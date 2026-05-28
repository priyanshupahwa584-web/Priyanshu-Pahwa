# Broadreach Operations Platform

Secure production web application for Broadreach operations data, Metro labeling, fulfilment reports, imports, exports, users, and activity logs.

## Architecture

- Frontend: React + Vite + TypeScript + Tailwind + Recharts
- Backend: Node.js + Express
- Auth: username/password, bcrypt hashes, JWT session cookie
- Data source: Google Sheets API
- File storage: Google Drive API
- Local label printing: Broadreach Windows Print Agent on each printing workstation
- Exports: CSV, XLSX, and PDF generated from real table/JSON data
- Deployment target: Google Cloud Run

Google credentials are used only by the backend. The frontend never receives service account JSON, private keys, or Google API credentials.

## Required Google Sheet Tabs

The app can initialize these tabs from Settings after credentials are configured:

- `OperationsData`
- `Users`
- `AuditLogs`
- `UploadLogs`
- `ExportLogs`
- `MetroLabeling`
- `FulfilmentReports`
- `PrintLogs`

### MetroLabeling

Columns:

`id, trackingNumber, barcodeValue, customerName, service, route, status, uploadedFileId, printedAt, printedBy, reprintCount, errorMessage, createdAt, updatedAt`

### FulfilmentReports

Columns:

`id, reportDate, client, service, route, totalUploaded, totalPrinted, pending, errors, completionPercent, createdBy, createdAt`

### PrintLogs

Columns:

`id, trackingNumber, action, userId, status, printerName, timestamp, errorMessage`

## Environment

Copy `.env.example` to `.env` for local development or set the same variables in Cloud Run:

```bash
PORT=4000
JWT_SECRET=replace-with-long-random-secret
ADMIN_USERNAME=Priyanshu
ADMIN_PASSWORD_HASH=replace-with-bcrypt-hash
GOOGLE_PROJECT_ID=your-project-id
GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=your-google-sheet-id
GOOGLE_DRIVE_FOLDER_ID=your-drive-folder-id
CORS_ORIGIN=http://127.0.0.1:4000
```

Create an admin hash locally:

```bash
node -e "import bcrypt from 'bcryptjs'; console.log(await bcrypt.hash('your-password', 12))"
```

No default password is shipped.

## Local Run

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:4000`.

## API

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/data`
- `POST /api/data`
- `PUT /api/data/:id`
- `DELETE /api/data/:id`
- `GET /api/dashboard`
- `POST /api/imports`
- `POST /api/exports`
- `GET /api/labels`
- `POST /api/labels/upload`
- `POST /api/labels/print`
- `POST /api/labels/print/confirm`
- `POST /api/labels/print/test`
- `GET /api/fulfilment/report`
- `POST /api/fulfilment/report/generate`
- `GET /api/fulfilment/report/export/csv`
- `GET /api/fulfilment/report/export/xlsx`
- `GET /api/fulfilment/report/export/pdf`
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `GET /api/logs/audit`
- `GET /api/health`

## Security

- Helmet security headers
- CORS allowlist
- Same-origin write protection for cookie sessions
- HTTPS required in production
- Global and login rate limiting
- Account lock after 5 failed attempts
- Passwords stored as bcrypt hashes only
- JWT stored in HTTP-only cookie
- UI inactivity timeout after 30 minutes
- Role/page access enforced by backend middleware
- Audit logs include actor, action, time, IP, device, and metadata
- No GmailApp, MailApp, hidden email sending, or exposed secrets
- Google credentials stay on the backend only
- Local printer API listens on localhost only and requires a workstation token

## Import and Export

Imports support `.csv`, `.xlsx`, `.xlsm`, and `.json`. Rows are validated before being saved to `OperationsData`. Uploaded files are stored in the configured Google Drive folder and logged in `UploadLogs`.

Exports generate real data files from filtered table data:

- CSV
- XLSX
- PDF

Each export includes filters, row count, user, and timestamp metadata. Exported files are uploaded to Google Drive and logged in `ExportLogs`.

## Metro Labeling

Metro Labeling accepts `.csv`, `.xlsx`, `.xlsm`, and `.json` files. The import reads real table fields such as Tracking Number, Driver, Routing Sequence, Delivery Address, City, and Postal Code, normalizes them into the `MetroLabeling` tab, and uploads the original file to a `Labels` folder in Google Drive.

Supported actions:

- Search by tracking number, barcode, customer/address, service, or route.
- Preview a real 4x2 label layout.
- Print one label, reprint a label, or bulk print selected labels.
- Write every print/reprint/error to `PrintLogs` and `AuditLogs`.

## Windows Print Agent

Browsers cannot securely access all Windows printers directly. Production label printing uses the local Broadreach Print Agent:

```powershell
cd D:\app\print-agent
npm start
```

To start it automatically at Windows login:

```powershell
powershell -ExecutionPolicy Bypass -File .\print-agent\install-agent.ps1
```

The agent listens only on `http://127.0.0.1:5055`, detects installed Windows printers, supports Zebra/ZPL jobs and PDF label jobs, and requires the token stored at:

```text
%APPDATA%\BroadreachPrintAgent\agent-config.json
```

Open Printer Setup in the web app, paste the token, detect printers, select the label printer, and send a test 4x2 label before live printing.

A simple packaged executable is also available at:

```text
print-agent\dist\BroadreachPrintAgent.exe
```

## Verification

```bash
npm run verify
```

Verification checks backend syntax, frontend typecheck/build, login behavior, health endpoint, the missing Google configuration message, Metro Labeling routes, Fulfilment Report routes, export routes, and the label print test route.

## Cloud Run Deployment

Build and push:

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/broadreach-operations-platform
```

Deploy:

```bash
gcloud run deploy broadreach-operations-platform \
  --image gcr.io/PROJECT_ID/broadreach-operations-platform \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars PORT=8080,NODE_ENV=production,GOOGLE_PROJECT_ID=PROJECT_ID,GOOGLE_CLIENT_EMAIL=SERVICE_ACCOUNT_EMAIL,GOOGLE_SHEET_ID=SHEET_ID,GOOGLE_DRIVE_FOLDER_ID=DRIVE_FOLDER_ID,CORS_ORIGIN=https://YOUR_SERVICE_URL \
  --set-secrets JWT_SECRET=JWT_SECRET:latest,ADMIN_PASSWORD_HASH=ADMIN_PASSWORD_HASH:latest,GOOGLE_PRIVATE_KEY=GOOGLE_PRIVATE_KEY:latest
```

Share the Google Sheet and Drive folder with the service account email.
