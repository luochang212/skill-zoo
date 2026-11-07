# Proposal

## Why

Commit `14bed88` fixed a re-import defect: re-registering the same source through a changed parent directory (`a/demo` → `b/demo`) triggered rename retirement keyed on the full recorded directory, removing the just-recreated flat link. The fix retires old links only when the flat `agent_link_name` changes. The existing "同目标链接重复导入幂等" scenario covers identical directories only; the spec should also pin the parent-path-change case that the fix addressed.

## What Changes

- Extend the `local-protocol` requirement 外部导入的源文件保持用户所有权 with one scenario: re-import through a changed parent directory whose flat link name is unchanged MUST keep the existing link and update the recorded directory without retiring links.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `local-protocol`: adds a re-import idempotency scenario for unchanged flat link names.
