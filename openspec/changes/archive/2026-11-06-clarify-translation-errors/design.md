# Decision

Match the observed structured `error.code=AccountQuotaExceeded` on HTTP 429 and return `quotaExceeded`. Other HTTP 429 responses keep `rateLimit`; do not infer quota state from free-form message text. The existing recursive stream-error unwrapping applies the same classification to connection tests and translations. Return only fixed application-owned codes.

Use the task error code to select existing localized error copy, falling back to “Translation failed” for unknown codes. Keep the existing optional skill-name prefix and one-toast-per-terminal-event behavior. Do not parse reset dates, add details panels, expose upstream content, or introduce automatic retries. ADR 5's unrelated `Unassigned` localization exception remains unchanged.

# Verification

Mock one quota rejection and compare probe and stream classification; also check ordinary limits, malformed responses, misleading message text and authentication precedence. Verify localized task toasts and unknown-code fallback, plus parallel background task attribution. No live model calls are required.
