# Contributing to PaperFlow

Thank you for your interest in contributing to **PaperFlow**!

## Development Workflow

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/iamnarace/paperflow.git
   cd paperflow
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Run quality checks before submitting a Pull Request:
   ```bash
   npm run lint
   npm test
   npm run build
   ```

## Design & Technical Guidelines

- **100% Client-Side Guarantee:** Never introduce external API calls or cloud upload endpoints for document processing.
- **Honest Feature Scope:** Only advertise PDF operations that are deterministically implemented and covered by unit tests in `src/test/`.
- **Accessibility:** Ensure all interactive buttons, form controls, and tab triggers include descriptive labels and keyboard focus states.
