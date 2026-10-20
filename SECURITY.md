# Security & Privacy Policy

## Client-Side Privacy Architecture

**PaperFlow** is designed as a strictly local, browser-side utility application:

- **Zero Server Uploads:** All PDF documents and images selected in PaperFlow are read into browser memory (`ArrayBuffer` / `Uint8Array`) via the standard HTML5 File API and manipulated locally using `pdf-lib`.
- **No Telemetry or External Calls:** PaperFlow does not transmit document contents, filenames, or metadata over the network.
- **Metadata Sanitization:** Use the **Inspector & Metadata** tab to clear hidden PDF header fields (`Title`, `Author`, `Subject`, `Creator`) before sharing documents externally. Note that stripping header metadata does not redact text or XMP streams embedded inside page content streams.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability within PaperFlow, please open a security advisory or issue on the GitHub repository (`https://github.com/iamnarace/paperflow`) without including sensitive personal documents.
