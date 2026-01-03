# Doria

Doria is a backend-driven platform that connects to Gmail, finds accounting invoices (PDF/JSON), removes duplicates, and generates structured ZIP packages ready to be delivered to an accountant.

It is designed to replace manual invoice collection from email with a repeatable, auditable, and secure process.

---

## What problem it solves

- Eliminates manual downloading of invoices from email
- Prevents duplicate files (same attachment or repeated filenames)
- Produces consistent, accountant-friendly ZIP packages
- Keeps a history of generated packages with secure downloads
- Supports role-based access for different user responsibilities

---

## Core features

- Gmail integration using OAuth (read-only access)
- Invoice search by date range and subject keywords
- Automatic deduplication of attachments
- ZIP generation with a clear internal structure:
  - PDFs and JSON grouped by email
  - Flat folder containing only PDFs
  - Metadata file with generation details
- Secure upload to AWS S3 with signed download URLs
- Package history and execution tracking
- Role-based access control (viewer, basic, admin)

---

## Tech stack

**Backend**
- Node.js + Express
- MongoDB Atlas
- Google Gmail API (OAuth 2.0)
- AWS S3 (ZIP storage)

**Frontend**
- React (Vite)
- Tailwind CSS
- Axios
- React Router

**Security & Infrastructure**
- JWT-based authentication
- Encrypted storage of OAuth refresh tokens
- Environment-based configuration
- Signed URLs for private file access

---

## High-level flow

1. User authenticates and connects a Gmail account
2. The system searches emails using configured keywords and date ranges
3. Invoice attachments (PDF/JSON) are extracted and deduplicated
4. A structured ZIP package is generated
5. The package is uploaded to S3 and made available via a signed URL
6. Metadata is stored for history and auditing

---

## Project structure
backend/    REST API, services, integrations, business logic
---

## Configuration

Sensitive configuration (database, OAuth, AWS, secrets) is handled via environment variables.
Real credentials are never committed to the repository.

---

## Notes

- Gmail access is strictly read-only
- No invoice content is permanently stored outside generated packages
- Temporary files are cleaned up after ZIP generation
- The system is designed for real accounting workflows, not demos

---

## Status

This project represents a production-style system built end-to-end, focusing on reliability, security, and real-world use cases.
