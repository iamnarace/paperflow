# Changelog

All notable changes to **PaperFlow** are documented in this file.

## [1.0.1] - 2026-10-20

### Changed
- **Comprehensive PDF Metadata Sanitization:** Expanded `stripPdfMetadata` and `inspectPdfBuffer` to detect and remove `/Info` dictionaries (including `Keywords`, `Producer`, `CreationDate`, `ModDate`, and custom keys) as well as catalog-level, page-level, and component-level `/Metadata` (XMP XML) and `/PieceInfo` streams.
- **Malformed Input Validation:** Added explicit `%PDF-` header and buffer size validation so empty or non-PDF inputs fail safely with descriptive error messages.
- **Object URL Lifecycle Management:** Ensured removed or cleared image preview `blob:` URLs are deterministically revoked without revoking active image previews.
- **Build & Test Tooling:** Upgraded Vite to v6 and Vitest to v4 with expanded byte-level PDF sanitization regression tests.

## [1.0.0] - 2026-10-20

### Added
- **PDF Merge Queue:** Combine multiple PDF documents locally in user-defined sequence while preserving vector content and page geometry.
- **Page Split, Extract & Reorder Studio:** Filter pages using range expressions (e.g., `1-3, 5`), toggle individual sheets, rotate pages in 90-degree increments, and reorder pages.
- **Image-to-PDF Converter:** Convert PNG and JPEG images into multi-page PDFs with A4, US Letter, or Fit-to-Image sizing, portrait/landscape orientation, and configurable margins.
- **Document Inspector & Metadata Sanitizer:** Inspect exact file size, page count, dimensions, creation/modification dates, and edit or strip identifying PDF metadata headers.
- **Sample Workspace Generator:** One-click in-memory generation of multi-page sample PDFs and PNG slides for instant evaluation.
- **Automated Verification:** Vitest unit and integration test suite and GitHub Actions CI pipeline.
