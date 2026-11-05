# Design

## Context

ProviderEditor had presentation and persistence modes controlled by optional header actions and autoSave. New providers used the discarded manual-save presentation despite now living inside the sidebar shell.

## Decisions

Remove that presentation and the autoSave switch. Render one editor branch, supplying the original rename header and deletion menu for both new and existing providers. Retain a draft until the first valid edit; the existing serialized write queue captures the backend-assigned creation ID before later queued writes execute. Preserve the same editor instance as creation becomes persistence, hydrating only its ID while retaining newer field values. Reset the editor on deliberate service navigation or discard using its existing revision.

Delete confirmation waits for outstanding writes: an unsaved draft is discarded locally; if creation completed meanwhile, delete the persisted identity. Provider selection remains the shared standalone picker.

## Risks / Trade-offs

- Duplicate creation during concurrent edits → assign the first returned ID within the serialized queue before the next write.
- Losing newer edits on first save → preserve the editor instance and track edit revision independently of ID hydration; regression tests cover deferred creation.
