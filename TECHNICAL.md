# Technical Documentation — belsafe (Backend-Less Secure AF File Exchanger)

## Architecture

```
Static Host (HTML/CSS/JS only) ──> Browser A
                              ──> Browser B

Browser A <──────────────────────> Browser B  (WebRTC data channels)
     │                                │
     ▼                                ▼
IndexedDB (encrypted)          IndexedDB (encrypted)
```

### Transport layer

Two transport modes, tried in order:

1. **PeerJS (WebRTC)** — Primary transport. Uses a **star topology**:
   - The first peer to claim the session ID becomes the **host**.
   - Subsequent peers connect as **clients** to the host.
   - All messages are routed through the host, which relays them to other clients.
   - This is *not* a full mesh — peers do not connect directly to each other.

2. **BroadcastChannel** — Fallback when PeerJS is unavailable (library not loaded, ID conflict). Same-origin only, same-browser only.

### Session model

- Session identity is an opaque random ID (132+ bits, CSPRNG).
- Stored in the URL fragment (`#s=<base64url_session_id>`).
- Fragment placement avoids sending the session ID in HTTP request headers.
- Optional: `#s=<id>&n=<nodeId>` to select a specific file on load, `#s=<id>&m=preview` for read-only preview mode.

---

## Data Model

### IndexedDB stores

| Store name | Key path | Purpose |
|---|---|---|
| `nodes` | `id` | Files and folders |
| `txLog` | `txId` | Committed transaction metadata |
| `txEntries` | `entryId` | Individual row-level mutations |

### Node record (nodes store)

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID |
| `parentId` | string\|null | `"root"` for root folder |
| `type` | `"folder"` \| `"file"` | — |
| `name` | — | *Not stored in plaintext* — see Encryption |
| `encryptedName` | `{ iv, data }` | AES-GCM encrypted name |
| `content` | — | *Not stored in plaintext* — see Encryption |
| `encryptedContent` | `{ kind, iv, data, mime }` | Encrypted content; `kind` = `"text"`, `"blob"`, or `"null"` |
| `mime` | string | MIME type (not encrypted) |
| `size` | number | File size in bytes |
| `updatedAt` | number | Unix timestamp (ms) |
| `encVersion` | number | Encryption schema version (currently 1) |

**Note:** The README data model spec mentions `createdAt`, `contentHash`, and a separate `fileBlobs` entity. These are **not yet implemented** — content is stored directly in the node record.

### Transaction log (txLog store)

| Field | Type | Notes |
|---|---|---|
| `txId` | string | UUID |
| `authorPeerId` | string | Originator peer |
| `logicalClock` | number | Monotonically increasing per-writer |
| `committedAt` | number | Unix timestamp (ms) |
| `schemaVersion` | number | Envelope schema version (currently 1) |
| `reason` | string | Human-readable label (e.g. `"nodes:create"`) |
| `meta` | object\|null | Extra context (previous names, counts, etc.) |
| `txHash` | string | Non-cryptographic 32-bit hash of envelope content |
| `entryCount` | number | Number of entries in this transaction |

**Note:** `prevTxHash` (for chain integrity) is defined in the spec but **not yet implemented**.

### Transaction entries (txEntries store)

| Field | Type | Notes |
|---|---|---|
| `entryId` | string | `"<txId>:<order>"` |
| `txId` | string | Foreign key to txLog |
| `order` | number | Position within the transaction |
| `table` | string | Target store (currently only `"nodes"`) |
| `action` | `"upsert"` \| `"delete"` | Mutation type |
| `primaryKey` | string | Node ID |
| `after` | object\|null | Encrypted node state after mutation |
| `meta` | object\|null | Extra context (deleted node name, type) |

---

## Encryption

### Key derivation

All keys are derived from the session ID using HKDF with SHA-256:

```
session ID (UTF-8)
    │
    ▼
HKDF-Extract(salt="belsfe-kdf-salt-v1", ikm=sessionId)
    │
    ├── HKDF-Expand(info="belsfe-at-rest-v1") ──> AES-128-GCM key (at-rest)
    └── HKDF-Expand(info="belsfe-transport-v1") ──> AES-128-GCM key (transport)
```

- Key length: 128 bits (AES-128)
- Two distinct subkeys: one for local storage, one for wire encryption.
- Keys are **never** persisted or transmitted.
- The `getHkdfBaseKey()` result is cached in `state.hkdfBaseKeyPromise` after first derivation.

### At-rest encryption

- Algorithm: AES-128-GCM
- Nonce: 12 random bytes per encryption (unique per record)
- Both file/folder **names** and file **contents** are encrypted before writing to IndexedDB.
- Encrypted payloads are stored as `{ iv: base64url, data: base64url }`.
- Content records include a `kind` discriminator (`"text"`, `"blob"`, `"null"`) so the decryptor knows the return type.
- Legacy (unencrypted) nodes are migrated on first load via `migrateNodesAtRestIfNeeded()`.

### In-transit encryption

- Transaction envelopes are serialized to JSON, then encrypted with AES-128-GCM before sending over the data channel.
- The transport key is separate from the at-rest key.
- The signaling channel (PeerJS server) never sees plaintext payloads.

---

## Synchronization Protocol

### Transaction lifecycle

1. A local UI action (create, rename, save, etc.) produces row-level entries.
2. Entries are wrapped in an **envelope** with metadata (txId, authorPeerId, logicalClock, etc.).
3. The envelope is applied locally (`applyTransactionEnvelope`), then broadcast to peers.
4. Peers receive, decrypt, deduplicate (by `txId` via `seenTxIds`), and apply the envelope atomically.

### Catch-up on join

When a peer receives a `"hello"` heartbeat from a peer with a higher logical clock, it sends a `"catchup-request"` specifying its current clock value. The responding peer replays all transactions since that clock.

### Idempotency

- `txId` uniqueness is enforced via `state.seenTxIds` (Set in memory, bootstrapped from IndexedDB on load).
- Duplicate envelopes are silently skipped.

### Chunking

Messages larger than 12,000 characters are split into chunks (`splitStringBySize`). Each chunk is sent as a `"tx-chunk"` message with a shared `chunkId`. The receiver reassembles chunks and processes the full envelope. Stale chunks (no activity for 2 minutes) are discarded.

### Progress reporting (current state)

- Chunk transfer progress is tracked as `sentChunks / totalChunks` and `receivedChunks / totalChunks`.
- Visual feedback is a CSS gradient on the peer status badge.
- **Speed (bytes/sec) and ETA are not yet implemented** — this is noted as future work.

---

## Features

### File operations

| Operation | Trigger | Transaction reason |
|---|---|---|
| Create folder | Button | `nodes:create` |
| Create text file | Button | `nodes:create` |
| Rename | Button or context menu | `nodes:rename` |
| Delete (recursive) | Button or context menu | `nodes:delete-recursive` |
| Duplicate (recursive) | Context menu | `nodes:duplicate` |
| Move file | Drag within tree | `nodes:move` |
| Save text | Auto-save (250ms debounce) | `nodes:text-save` |
| Import files | Drag & drop or file picker | `nodes:import-file` |
| Import folder | Drag & drop or folder picker | `nodes:import-folder` |

### Editor

- Text files (.txt, .md, .json, .js, .ts, .css, .html) are loaded as editable text.
- Auto-save triggers 250ms after the last keystroke.
- **Markdown preview** is available for `.md` files (and `.markdown` / `text/markdown`).
  - Toggle with the Preview button or keyboard: `Ctrl+P` (edit→preview), `E` (preview→edit).
  - Preview mode hides the sidebar automatically.
  - Images referenced in Markdown are resolved relative to the file's parent folder.
- **Image preview** for image MIME types (PNG, JPEG, GIF, WebP, BMP, SVG).
- **Download** is available for any file type.

### Settings panel

| Section | Contents |
|---|---|
| Theme | Auto / Light / Dark |
| Network (ICE/TURN) | JSON editor for ICE server config, save/reset |
| DB Transaction Log | List of all committed transactions |
| Connection & Replication Events | Log of transport and sync events |
| Errors and warnings | Runtime issues log |

### Connection diagnostics

Hover or focus the peer status badge to see a popover with:
- Transport mode and PeerJS library status
- Open data connections count
- WebRTC candidate types (host, srflx, relay)
- TURN relay path status
- Fallback channel status
- Chunk transfer progress
- Last replication event

### Keyboard shortcuts

| Key | Context | Action |
|---|---|---|
| `Escape` | Any | Close context menu, settings, QR popover |
| `Ctrl+P` | Edit mode | Switch to Markdown preview |
| `E` | Preview mode | Switch to edit |

---

## Security & Privacy

### Intended properties

- No backend file hosting by the app.
- No backend persistence of user files by the app.
- Local encrypted-at-rest browser storage.
- Direct peer transport for shared content.
- PeerJS/signaling server cannot read replication payload plaintext.

### Known limitations

- Strong identity verification of participants is not yet implemented.
- Revocation and role-based access control is not yet implemented.
- Forward secrecy and formal key rotation policy is not yet implemented.
- Malicious peer resistance beyond transport/session secrecy is not yet implemented.
- The encryption key is derived from the session ID (visible in the URL), so anyone with the link can derive the key.

### Threat model (draft)

| Threat | Mitigation |
|---|---|
| Unauthorized user obtains session link | High-entropy IDs (132+ bits) |
| Malicious peer sends malformed envelopes | Strict input validation, idempotency checks |
| Replay attacks | txId deduplication |
| Malicious signaling infrastructure | End-to-end application-layer encryption |
| Local browser compromise (XSS, extension) | CSP-compatible static hosting |

---

## Configuration

### ICE/TURN servers

Default: Google public STUN servers. Custom ICE servers can be configured in Settings → Network (ICE/TURN). The config is a JSON array:

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  { "urls": "turn:turn.example.com:3478", "username": "user", "credential": "pass" }
]
```

The config can also be set globally via `window.BELSFE_ICE_SERVERS` before `app.js` loads.

### Theme

Stored in localStorage as `belsfe_themeMode`. Values: `"auto"`, `"light"`, `"dark"`. Auto mode follows the system `prefers-color-scheme` media query.

---

## Limits and Non-Goals

- No explicit file size cap, but browser memory/IndexedDB quotas apply.
- No collaborative conflict-free editing (last-writer-wins per transaction).
- No multi-device account sync through a backend.
- No full end-user identity management.
- No guaranteed delivery with offline queuing.

## Future Work

- Robust authentication and trust establishment.
- Optional passphrase-protected sessions.
- Key rotation and rekeying on participant changes.
- Large file transfer resilience (chunk ACK, retry, resume).
- Conflict resolution strategy for concurrent transaction streams.
- Peer presence, permissions, and audit trail UX.
- End-to-end integrity signatures per transaction envelope.
- Speed/ETA tracking for transfers.