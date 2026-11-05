# Tasks

- [x] Separate observed quota errors from other request limits in shared backend classification.
- [x] Show safe localized failure reasons in the existing toast and update both languages.
- [x] Run targeted backend/frontend tests and type/lint/format/spec checks, sync main specs and archive.

Verification: all 14 LLM service tests and 64 targeted frontend tests pass. Type checking, lint and frontend format checks pass. Mocked quota rejection exercises both connection testing and translation streaming without retries or leaking echoed credentials. No live inference calls were made.
