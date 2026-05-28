# Broadreach Print Agent

The web app cannot securely access all Windows printers directly from the browser. Install this local agent on each workstation that has a Zebra or label printer connected.

## Run Locally

```powershell
cd E:\app\print-agent
npm start
```

The agent listens only on `http://127.0.0.1:5055`.

## Packaged EXE

```text
dist\BroadreachPrintAgent.exe
```

If you rebuild it:

```powershell
npm run build:exe
```

## Install At Windows Login

```powershell
powershell -ExecutionPolicy Bypass -File .\install-agent.ps1
```

The first run creates a local token at:

```text
%APPDATA%\BroadreachPrintAgent\agent-config.json
```

Enter that token in the web app Printer Setup page, select the label printer, and run a test print before live printing.

## API

`GET /printers` returns installed Windows printers.

`POST /print` accepts a 4x2 label payload with `type: "zpl"` or `type: "pdf"`.

All printer endpoints require `x-agent-token`. The agent does not expose printer access to the network.
