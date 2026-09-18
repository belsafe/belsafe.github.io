const DB_NAME_PREFIX = "belsfe_db";
const STORAGE_KEY_PREFIX = "belsfe";
const DB_VERSION = 3;
const STORE_NODES = "nodes";
const STORE_TX_LOG = "txLog";
const STORE_TX_ENTRIES = "txEntries";
const STORE_META = "meta";
const ROOT_ID = "root";
const SESSION_BITS = 132;
const SESSION_CHARS = Math.ceil(SESSION_BITS / 6);
const KEY_DERIVATION_SALT = "belsfe-kdf-salt-v1";
const KEY_INFO_TRANSPORT = "belsfe-transport-v1";
const KEY_INFO_AT_REST = "belsfe-at-rest-v1";
const PEER_HEARTBEAT_MS = 60000;
const PEER_STALE_MS = 150000;
const TX_CHUNK_MAX_CHARS = 12000;
const TX_CHUNK_STALE_MS = 120000;
const RECENT_FILES_LIMIT = 6;
const EDITOR_SAVE_DEBOUNCE_MS = 5000;
const EYE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const state = {
  nodes: [],
  selectedId: null,
  expanded: new Set([ROOT_ID]),
  saveTimer: null,
  contextNodeId: null,
  dragNodeId: null,
  localPeerId: null,
  logicalClock: 0,
  themeMode: "auto",
  sessionId: null,
  sessionUrl: null,
  requestedSelectedId: null,
  transportMode: "none",
  replicationChannel: null,
  peerjsPeer: null,
  peerjsHostConn: null,
  peerjsConns: new Map(),
  peerjsIsHost: false,
  peerjsHostId: null,
  rtcDiagTimer: null,
  rtcDiagnostics: {
    relayState: "unknown",
    candidateTypes: "n/a",
    updatedAt: 0,
    error: null,
  },
  transportKeyPromise: null,
  seenTxIds: new Set(),
  peerPresence: new Map(),
  heartbeatTimer: null,
  presenceSweepTimer: null,
  replicationEvents: [],
  issues: [],
  atRestKeyPromise: null,
  hkdfBaseKeyPromise: null,
  editorMode: "edit",
  editorScrollTop: 0,
  sidebarHidden: false,
  previewObjectUrl: null,
  previewImageObjectUrls: [],
  inboundTxChunks: new Map(),
  chunkTransfer: {
    active: false,
    txId: null,
    sentChunks: 0,
    totalChunks: 0,
    lastTxId: null,
    lastSentChunks: 0,
    lastTotalChunks: 0,
    updatedAt: 0,
  },
  chunkTransferRx: {
    active: false,
    chunkId: null,
    txId: null,
    fromPeerId: null,
    receivedChunks: 0,
    totalChunks: 0,
    lastChunkId: null,
    lastTxId: null,
    lastFromPeerId: null,
    lastReceivedChunks: 0,
    lastTotalChunks: 0,
    updatedAt: 0,
  },
  qrCodeHoverTimer: null,
  dbName: null,
  sessionTitle: null,
};

const ui = {
  tree: document.getElementById("tree"),
  recentList: document.getElementById("recentList"),
  editor: document.getElementById("editor"),
  editorTitle: document.getElementById("editorTitle"),
  editorMeta: document.getElementById("editorMeta"),
  preview: document.getElementById("preview"),
  saveBtn: document.getElementById("saveBtn"),
  previewBtn: document.getElementById("previewBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  newFolderBtn: document.getElementById("newFolderBtn"),
  newFileBtn: document.getElementById("newFileBtn"),
  renameBtn: document.getElementById("renameBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  importBtn: document.getElementById("importBtn"),
  importFolderBtn: document.getElementById("importFolderBtn"),
  importInput: document.getElementById("importInput"),
  importFolderInput: document.getElementById("importFolderInput"),
  dropZone: document.getElementById("dropZone"),
  createName: document.getElementById("createName"),
  contextMenu: document.getElementById("contextMenu"),
  ctxDownloadBtn: document.getElementById("ctxDownloadBtn"),
  ctxRenameBtn: document.getElementById("ctxRenameBtn"),
  ctxDuplicateBtn: document.getElementById("ctxDuplicateBtn"),
  ctxDeleteBtn: document.getElementById("ctxDeleteBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  settingsCloseBtn: document.getElementById("settingsCloseBtn"),
  themeSelect: document.getElementById("themeSelect"),
  iceServersInput: document.getElementById("iceServersInput"),
  saveIceServersBtn: document.getElementById("saveIceServersBtn"),
  resetIceServersBtn: document.getElementById("resetIceServersBtn"),
  iceServersStatus: document.getElementById("iceServersStatus"),
  toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
  treePanel: document.getElementById("treePanel"),
  refreshTxLogBtn: document.getElementById("refreshTxLogBtn"),
  txLogList: document.getElementById("txLogList"),
  clearReplicationLogBtn: document.getElementById("clearReplicationLogBtn"),
  replicationLogList: document.getElementById("replicationLogList"),
  clearIssuesBtn: document.getElementById("clearIssuesBtn"),
  issuesList: document.getElementById("issuesList"),
  sessionLabel: document.getElementById("sessionLabel"),
  copySessionBtn: document.getElementById("copySessionBtn"),
  qrCodePopover: document.getElementById("qrCodePopover"),
  qrCodeContainer: document.getElementById("qrCodeContainer"),
  peerStatus: document.getElementById("peerStatus"),
  connectionPopover: document.getElementById("connectionPopover"),
  sessionTitle: document.getElementById("sessionTitle"),
};

let db;
let prefersDarkQuery;

async function init() {
  initTheme();
  initSession();
  db = await openDb();
  state.localPeerId = getOrCreateLocalPeerId();
  await migrateNodesAtRestIfNeeded();
  await bootstrapLogicalClock();
  await ensureRoot();
  await bootstrapTxLogFromLegacyNodesIfNeeded();
  await bootstrapSeenTxIds();
  await loadSessionTitle();
  await refreshNodes();
  initReplicationChannel();
  wireUi();
  render();
  renderTitle();
  if (state.sidebarHidden) {
    setSidebarHidden(true);
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(getSessionDbName(), DB_VERSION);

    req.onupgradeneeded = () => {
      const instance = req.result;
      if (!instance.objectStoreNames.contains(STORE_NODES)) {
        const store = instance.createObjectStore(STORE_NODES, { keyPath: "id" });
        store.createIndex("by_parentId", "parentId", { unique: false });
      }

      if (!instance.objectStoreNames.contains(STORE_TX_LOG)) {
        const txLog = instance.createObjectStore(STORE_TX_LOG, { keyPath: "txId" });
        txLog.createIndex("by_logicalClock", "logicalClock", { unique: false });
      }

      if (!instance.objectStoreNames.contains(STORE_TX_ENTRIES)) {
        const txEntries = instance.createObjectStore(STORE_TX_ENTRIES, { keyPath: "entryId" });
        txEntries.createIndex("by_txId", "txId", { unique: false });
      }

      if (!instance.objectStoreNames.contains(STORE_META)) {
        instance.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode = "readonly") {
  return db.transaction(STORE_NODES, mode).objectStore(STORE_NODES);
}

function localStorageKey(name) {
  return `${STORAGE_KEY_PREFIX}_${name}`;
}

function getSessionDbName() {
  if (!state.dbName) {
    const suffix = getOrCreateSessionDbAlias(state.sessionId || "default");
    state.dbName = `${DB_NAME_PREFIX}_${suffix}`;
  }
  return state.dbName;
}

function getOrCreateSessionDbAlias(sessionId) {
  const storageKey = localStorageKey("sessionDbAliasMapV1");
  const map = loadSessionDbAliasMap(storageKey);
  const existing = map[sessionId];
  if (typeof existing === "string" && existing) {
    return existing;
  }

  const created = `s${randomId().slice(0, 22)}`;
  map[sessionId] = created;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch (_error) {
    // Ignore storage write failures and continue in-memory.
  }
  return created;
}

function loadSessionDbAliasMap(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (_error) {
    return {};
  }
}

function normalizeIceServers(candidate) {
  if (!Array.isArray(candidate)) {
    return null;
  }

  const normalized = [];
  for (const item of candidate) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const urls = item.urls;
    const urlsValid =
      typeof urls === "string" ||
      (Array.isArray(urls) && urls.length > 0 && urls.every((value) => typeof value === "string"));
    if (!urlsValid) {
      return null;
    }

    const next = { urls };
    if (typeof item.username === "string") {
      next.username = item.username;
    }
    if (typeof item.credential === "string") {
      next.credential = item.credential;
    }
    if (typeof item.credentialType === "string") {
      next.credentialType = item.credentialType;
    }
    normalized.push(next);
  }

  return normalized.length ? normalized : null;
}

function normalizeIceServersConfig(candidate) {
  const direct = normalizeIceServers(candidate);
  if (direct) {
    return direct;
  }

  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return normalizeIceServers(candidate.iceServers);
  }

  return null;
}

function getConfiguredIceServers() {
  const globalConfig = normalizeIceServersConfig(window.BELSFE_ICE_SERVERS);
  if (globalConfig) {
    return globalConfig;
  }

  const stored = window.localStorage.getItem(localStorageKey("iceServersJson"));
  if (!stored) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(stored);
    const normalized = normalizeIceServersConfig(parsed);
    if (normalized) {
      return normalized;
    }
  } catch (_error) {
    // Ignore invalid local value and fallback to defaults.
  }

  return DEFAULT_ICE_SERVERS;
}

function getStoredIceServersJson() {
  return window.localStorage.getItem(localStorageKey("iceServersJson")) || "";
}

function setIceServersStatus(message) {
  if (!ui.iceServersStatus) {
    return;
  }
  ui.iceServersStatus.textContent = message;
}

function renderIceServersSettings() {
  if (!ui.iceServersInput) {
    return;
  }

  const stored = getStoredIceServersJson();
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      ui.iceServersInput.value = JSON.stringify(parsed, null, 2);
    } catch (_error) {
      ui.iceServersInput.value = stored;
    }
    setIceServersStatus("Custom ICE config loaded. Reload page to apply after changes.");
    return;
  }

  ui.iceServersInput.value = JSON.stringify(DEFAULT_ICE_SERVERS, null, 2);
  setIceServersStatus("Using default STUN only. Add TURN for cross-network reliability.");
}

function onSaveIceServersConfig() {
  if (!ui.iceServersInput) {
    return;
  }

  const raw = ui.iceServersInput.value.trim();
  if (!raw) {
    window.localStorage.removeItem(localStorageKey("iceServersJson"));
    renderIceServersSettings();
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeIceServersConfig(parsed);
    if (!normalized) {
      setIceServersStatus("Invalid ICE JSON. Expected an array or an object with iceServers.");
      return;
    }

    window.localStorage.setItem(localStorageKey("iceServersJson"), JSON.stringify(normalized));
    setIceServersStatus("ICE config saved. Reload page to reconnect using this config.");
  } catch (_error) {
    setIceServersStatus("Invalid JSON syntax. Please fix and save again.");
  }
}

function onResetIceServersConfig() {
  window.localStorage.removeItem(localStorageKey("iceServersJson"));
  renderIceServersSettings();
}

function initTheme() {
  state.themeMode = getStoredThemeMode();
  applyThemeMode(state.themeMode);

  prefersDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  prefersDarkQuery.addEventListener("change", () => {
    if (state.themeMode === "auto") {
      applyThemeMode("auto");
    }
  });
}

function getStoredThemeMode() {
  const key = localStorageKey("themeMode");
  const mode = window.localStorage.getItem(key);
  if (mode === "light" || mode === "dark" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function applyThemeMode(mode) {
  const resolved = mode === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;
  state.themeMode = mode;
  document.documentElement.setAttribute("data-theme", resolved);
  window.localStorage.setItem(localStorageKey("themeMode"), mode);
  if (ui.themeSelect) {
    ui.themeSelect.value = mode;
  }
}

function initSession() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const params = new URLSearchParams(hash);
  let sessionId = params.get("s");
  const requestedNodeId = params.get("n");
  if (!sessionId) {
    sessionId = generateSessionId();
    params.set("s", sessionId);
    const nextHash = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${nextHash}`);
  }

  const requestedMode = params.get("m");

  state.sessionId = sessionId;
  state.requestedSelectedId = requestedNodeId || null;
  if (requestedMode === "preview") {
    state.editorMode = "preview";
    state.sidebarHidden = true;
  }
  updateSessionUrl();
  updateSessionLabel();
}

function buildHashParams() {
  const params = new URLSearchParams();
  if (state.sessionId) {
    params.set("s", state.sessionId);
  }
  if (state.selectedId) {
    params.set("n", state.selectedId);
  }
  if (state.editorMode === "preview") {
    params.set("m", "preview");
  }
  return params;
}

function updateSessionUrl() {
  const params = buildHashParams();
  state.sessionUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#${params.toString()}`;
}

function syncHashWithState() {
  const params = buildHashParams();
  const nextHash = `#${params.toString()}`;
  if (window.location.hash === nextHash) {
    return;
  }
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  updateSessionUrl();
}

function generateSessionId() {
  const bytes = new Uint8Array(17);
  window.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes).slice(0, SESSION_CHARS);
}

function updateSessionLabel() {
  if (!ui.sessionLabel || !state.sessionId) {
    return;
  }

  const short = state.sessionId.slice(0, 10);
  ui.sessionLabel.textContent = `Session: ${short}...`;
  ui.sessionLabel.title = state.sessionId;
}

const DEFAULT_TITLE = "Backend-Less Secure AF File Exchanger \u2014 Untitled";

async function loadSessionTitle() {
  const store = db.transaction(STORE_META, "readonly").objectStore(STORE_META);
  const record = await reqToPromise(store.get("sessionTitle"));
  if (record && record.value) {
    state.sessionTitle = record.value;
  } else {
    state.sessionTitle = DEFAULT_TITLE;
    const writeTx = db.transaction(STORE_META, "readwrite");
    writeTx.objectStore(STORE_META).put({ key: "sessionTitle", value: DEFAULT_TITLE });
    await waitForTransaction(writeTx);
  }
}

async function saveMetaValue(key, value, reason) {
  const entry = {
    table: STORE_META,
    action: "upsert",
    primaryKey: key,
    after: { key, value },
  };
  await commitLocalNodeEntries([entry], reason || "meta:update");
}

async function syncMetaState() {
  const store = db.transaction(STORE_META, "readonly").objectStore(STORE_META);
  const record = await reqToPromise(store.get("sessionTitle"));
  if (record && record.value && record.value !== state.sessionTitle) {
    state.sessionTitle = record.value;
    renderTitle();
  }
}

function renderTitle() {
  if (ui.sessionTitle && document.activeElement !== ui.sessionTitle) {
    ui.sessionTitle.textContent = state.sessionTitle || DEFAULT_TITLE;
  }
  document.title = state.sessionTitle || DEFAULT_TITLE;
}

async function onSessionTitleInput() {
  const raw = ui.sessionTitle && ui.sessionTitle.textContent;
  const newTitle = (raw && raw.trim()) || DEFAULT_TITLE;
  if (newTitle === state.sessionTitle) {
    if (ui.sessionTitle && ui.sessionTitle.textContent !== newTitle) {
      ui.sessionTitle.textContent = newTitle;
    }
    return;
  }
  state.sessionTitle = newTitle;
  document.title = newTitle;
  if (ui.sessionTitle && ui.sessionTitle.textContent !== newTitle) {
    ui.sessionTitle.textContent = newTitle;
  }
  await saveMetaValue("sessionTitle", newTitle, "meta:title-edit");
}

async function onCopySessionLink() {
  if (!state.sessionUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.sessionUrl);
    ui.copySessionBtn.textContent = "Copied";
    window.setTimeout(() => {
      ui.copySessionBtn.textContent = "Copy Link";
    }, 1000);
  } catch (_error) {
    window.prompt("Copy this session link:", state.sessionUrl);
  }
}

function getOrCreateLocalPeerId() {
  const key = localStorageKey("tabPeerId");
  const existing = window.sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }

  const created = randomId();
  window.sessionStorage.setItem(key, created);
  return created;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function ensureRoot() {
  const store = tx();
  const root = await reqToPromise(store.get(ROOT_ID));
  if (root) {
    return;
  }

  const now = Date.now();
  const rootNode = makeNode({
    id: ROOT_ID,
    parentId: null,
    type: "folder",
    name: "Shared",
    mime: null,
    content: null,
    updatedAt: now,
    size: 0,
  });
  await commitLocalNodeEntries([makeUpsertEntry(rootNode)], "system:root-init");
}

async function refreshNodes() {
  const store = tx();
  const rawNodes = await reqToPromise(store.getAll());
  const nodes = [];
  let skipped = 0;
  for (const rawNode of rawNodes) {
    const decoded = await decodeNodeForRead(rawNode, "refreshNodes");
    if (decoded) {
      nodes.push(decoded);
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    addIssue("warn", "Skipped undecryptable local records", {
      error: `count=${skipped}`,
    });
  }
  state.nodes = nodes;
  const hasCurrent = !!state.selectedId && state.nodes.some((node) => node.id === state.selectedId);
  const hasRequested =
    !!state.requestedSelectedId && state.nodes.some((node) => node.id === state.requestedSelectedId);

  if (hasRequested) {
    state.selectedId = state.requestedSelectedId;
    state.requestedSelectedId = null;
  } else if (!hasCurrent) {
    state.selectedId = ROOT_ID;
  }

  updateSessionUrl();
}

async function migrateNodesAtRestIfNeeded() {
  const readTx = db.transaction(STORE_NODES, "readonly");
  const readStore = readTx.objectStore(STORE_NODES);
  const rawNodes = await reqToPromise(readStore.getAll());
  const legacy = rawNodes.filter((node) => !hasEncryptedField(node));
  if (!legacy.length) {
    return;
  }

  const prepared = [];
  for (const node of legacy) {
    const encrypted = await encodeNodeForStorage(makeNode(node));
    prepared.push(encrypted);
  }

  const writeTx = db.transaction(STORE_NODES, "readwrite");
  const writeStore = writeTx.objectStore(STORE_NODES);
  for (const encrypted of prepared) {
    writeStore.put(encrypted);
  }
  await waitForTransaction(writeTx);
}

function hasEncryptedField(node) {
  return !!(node && node.encryptedName && node.encryptedName.iv && node.encryptedName.data);
}

async function encodeNodeForStorage(node) {
  if (hasEncryptedField(node)) {
    return node;
  }

  const atRestKey = await getAtRestKey();
  const encryptedName = await encryptStringAtRest(node.name || "", atRestKey);
  const encryptedContent = await encryptContentAtRest(node.content, node.mime, atRestKey);

  return {
    id: node.id,
    parentId: node.parentId,
    type: node.type,
    mime: node.mime ?? null,
    updatedAt: node.updatedAt ?? Date.now(),
    size: node.size ?? 0,
    encryptedName,
    encryptedContent,
    encVersion: 1,
  };
}

async function decodeNodeFromStorage(rawNode) {
  if (!rawNode) {
    return null;
  }

  if (!hasEncryptedField(rawNode)) {
    return makeNode(rawNode);
  }

  const atRestKey = await getAtRestKey();
  const name = await decryptStringAtRest(rawNode.encryptedName, atRestKey);
  const content = await decryptContentAtRest(rawNode.encryptedContent, rawNode.mime, atRestKey);

  return makeNode({
    id: rawNode.id,
    parentId: rawNode.parentId,
    type: rawNode.type,
    name,
    mime: rawNode.mime ?? null,
    content,
    updatedAt: rawNode.updatedAt,
    size: rawNode.size,
  });
}

async function decodeNodeForRead(rawNode, context) {
  try {
    return await decodeNodeFromStorage(rawNode);
  } catch (error) {
    addIssue("warn", "Skipped undecryptable local record", {
      error: `${context}: ${error && error.message ? error.message : String(error)}`,
    });
    return null;
  }
}

async function encryptStringAtRest(value, key) {
  const bytes = new TextEncoder().encode(value);
  const encrypted = await encryptBytesAtRest(bytes, key);
  return {
    iv: encrypted.iv,
    data: encrypted.data,
  };
}

async function decryptStringAtRest(payload, key) {
  const bytes = await decryptBytesAtRest(payload, key);
  return new TextDecoder().decode(bytes);
}

async function encryptContentAtRest(content, mime, key) {
  if (content === null || content === undefined) {
    return { kind: "null" };
  }

  if (typeof content === "string") {
    const encrypted = await encryptBytesAtRest(new TextEncoder().encode(content), key);
    return {
      kind: "text",
      iv: encrypted.iv,
      data: encrypted.data,
    };
  }

  if (content instanceof Blob) {
    const bytes = new Uint8Array(await content.arrayBuffer());
    const encrypted = await encryptBytesAtRest(bytes, key);
    return {
      kind: "blob",
      mime: mime || content.type || "application/octet-stream",
      iv: encrypted.iv,
      data: encrypted.data,
    };
  }

  return { kind: "null" };
}

async function decryptContentAtRest(payload, mime, key) {
  if (!payload || payload.kind === "null") {
    return null;
  }

  if (payload.kind === "text") {
    const bytes = await decryptBytesAtRest(payload, key);
    return new TextDecoder().decode(bytes);
  }

  if (payload.kind === "blob") {
    const bytes = await decryptBytesAtRest(payload, key);
    return new Blob([bytes], { type: payload.mime || mime || "application/octet-stream" });
  }

  return null;
}

async function encryptBytesAtRest(bytes, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return {
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(encrypted)),
  };
}

async function decryptBytesAtRest(payload, key) {
  const iv = base64UrlToBytes(payload.iv);
  const data = base64UrlToBytes(payload.data);
  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new Uint8Array(decrypted);
}

function makeNode(partial) {
  return {
    id: partial.id,
    parentId: partial.parentId,
    type: partial.type,
    name: partial.name,
    mime: partial.mime ?? null,
    content: partial.content ?? null,
    updatedAt: partial.updatedAt ?? Date.now(),
    size: partial.size ?? 0,
  };
}

function makeUpsertEntry(node) {
  return {
    table: STORE_NODES,
    action: "upsert",
    primaryKey: node.id,
    after: makeNode(node),
  };
}

function makeDeleteEntry(nodeId) {
  const node = state.nodes.find((item) => item.id === nodeId);
  return {
    table: STORE_NODES,
    action: "delete",
    primaryKey: nodeId,
    meta: node
      ? {
          name: node.name,
          nodeType: node.type,
        }
      : undefined,
  };
}

function makeTxHashBase(envelope) {
  const entryKey = envelope.entries
    .map((entry) => `${entry.order}|${entry.table}|${entry.action}|${entry.primaryKey}`)
    .join(";");
  return `${envelope.txId}|${envelope.authorPeerId}|${envelope.logicalClock}|${envelope.committedAt}|${entryKey}`;
}

function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function createEnvelope(entries, reason, meta) {
  state.logicalClock += 1;
  const txId = randomId();
  const committedAt = Date.now();

  const normalized = entries.map((entry, index) => ({
    order: index,
    table: entry.table,
    action: entry.action,
    primaryKey: entry.primaryKey,
    after: entry.after !== undefined ? (entry.table === STORE_NODES ? makeNode(entry.after) : entry.after) : undefined,
    meta: entry.meta,
  }));

  const envelope = {
    txId,
    authorPeerId: state.localPeerId,
    logicalClock: state.logicalClock,
    committedAt,
    schemaVersion: 1,
    reason,
    meta,
    entries: normalized,
  };
  envelope.txHash = simpleHash(makeTxHashBase(envelope));
  return envelope;
}

async function commitLocalNodeEntries(entries, reason, meta) {
  if (!entries.length) {
    return null;
  }
  const envelope = createEnvelope(entries, reason, meta);
  await applyTransactionEnvelope(envelope, { persistLog: true });
  state.seenTxIds.add(envelope.txId);
  await broadcastEnvelope(envelope);
  if (isSettingsOpen()) {
    await renderTxLog();
  }
  return envelope;
}

async function applyTransactionEnvelope(envelope, options = {}) {
  const persistLog = options.persistLog !== false;

  const preparedEntries = [];
  for (const entry of envelope.entries) {
    const prepared = { ...entry };
    if (entry.table === STORE_NODES && entry.after) {
      prepared.preparedAfter = await encodeNodeForStorage(makeNode(entry.after));
    } else {
      prepared.preparedAfter = entry.after;
    }
    preparedEntries.push(prepared);
  }

  const transaction = db.transaction([STORE_NODES, STORE_META, STORE_TX_LOG, STORE_TX_ENTRIES], "readwrite");
  const nodesStore = transaction.objectStore(STORE_NODES);
  const metaStore = transaction.objectStore(STORE_META);
  const txLogStore = transaction.objectStore(STORE_TX_LOG);
  const txEntriesStore = transaction.objectStore(STORE_TX_ENTRIES);

  if (persistLog) {
    const logRecord = {
      txId: envelope.txId,
      authorPeerId: envelope.authorPeerId,
      logicalClock: envelope.logicalClock,
      committedAt: envelope.committedAt,
      schemaVersion: envelope.schemaVersion,
      reason: envelope.reason,
      meta: envelope.meta,
      txHash: envelope.txHash,
      entryCount: envelope.entries.length,
    };
    txLogStore.put(logRecord);
  }

  for (const entry of preparedEntries) {
    if (persistLog) {
      const txEntryRecord = {
        entryId: `${envelope.txId}:${entry.order}`,
        txId: envelope.txId,
        order: entry.order,
        table: entry.table,
        action: entry.action,
        primaryKey: entry.primaryKey,
        after: entry.preparedAfter,
        meta: entry.meta,
      };
      txEntriesStore.put(txEntryRecord);
    }

    if (entry.table === STORE_META) {
      if (entry.action === "upsert" && entry.preparedAfter !== undefined) {
        metaStore.put(entry.preparedAfter);
      } else if (entry.action === "delete") {
        metaStore.delete(entry.primaryKey);
      }
      continue;
    }

    if (entry.table !== STORE_NODES) {
      continue;
    }

    if (entry.action === "upsert" && entry.after) {
      nodesStore.put(entry.preparedAfter);
      continue;
    }

    if (entry.action === "delete") {
      nodesStore.delete(entry.primaryKey);
    }
  }

  await waitForTransaction(transaction);
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function bootstrapLogicalClock() {
  const transaction = db.transaction(STORE_TX_LOG, "readonly");
  const store = transaction.objectStore(STORE_TX_LOG);
  const all = await reqToPromise(store.getAll());
  state.logicalClock = all.reduce((max, record) => Math.max(max, record.logicalClock || 0), 0);
}

async function bootstrapSeenTxIds() {
  const logs = await listTransactionLog();
  state.seenTxIds = new Set(logs.map((log) => log.txId));
}

async function bootstrapTxLogFromLegacyNodesIfNeeded() {
  const logTx = db.transaction(STORE_TX_LOG, "readonly");
  const txLog = logTx.objectStore(STORE_TX_LOG);
  const existingLogs = await reqToPromise(txLog.getAllKeys());
  if (existingLogs.length > 0) {
    return;
  }

  const nodesTx = db.transaction(STORE_NODES, "readonly");
  const nodesStore = nodesTx.objectStore(STORE_NODES);
  const rawNodes = await reqToPromise(nodesStore.getAll());
  const nodes = [];
  for (const rawNode of rawNodes) {
    const decoded = await decodeNodeForRead(rawNode, "bootstrapTxLogFromLegacyNodesIfNeeded");
    if (decoded) {
      nodes.push(decoded);
    }
  }
  if (!nodes.length) {
    return;
  }

  const entries = nodes
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => makeUpsertEntry(node));

  await commitLocalNodeEntries(entries, "system:legacy-bootstrap");
}

function collectDescendantIds(rootId) {
  const collected = [];
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop();
    collected.push(current);
    const children = state.nodes.filter((n) => n.parentId === current);
    for (const child of children) {
      stack.push(child.id);
    }
  }
  return collected;
}

async function listTransactionLog() {
  const transaction = db.transaction(STORE_TX_LOG, "readonly");
  const store = transaction.objectStore(STORE_TX_LOG);
  const logs = await reqToPromise(store.getAll());
  return logs.sort((a, b) => {
    if (a.logicalClock !== b.logicalClock) {
      return a.logicalClock - b.logicalClock;
    }
    return a.committedAt - b.committedAt;
  });
}

async function getTransactionEntries(txId) {
  const transaction = db.transaction(STORE_TX_ENTRIES, "readonly");
  const store = transaction.objectStore(STORE_TX_ENTRIES);
  const byTxId = store.index("by_txId");
  const entries = await reqToPromise(byTxId.getAll(txId));
  const decoded = [];
  for (const entry of entries) {
    decoded.push({
      ...entry,
      after: entry.after ? (entry.table === STORE_NODES ? await decodeNodeForRead(entry.after, "getTransactionEntries") : entry.after) : undefined,
    });
  }
  return decoded.sort((a, b) => a.order - b.order);
}

async function replayTransactionsFromLog() {
  const logs = await listTransactionLog();
  const clearTx = db.transaction(STORE_NODES, "readwrite");
  clearTx.objectStore(STORE_NODES).clear();
  await waitForTransaction(clearTx);

  for (const log of logs) {
    const entries = await getTransactionEntries(log.txId);
    const envelope = {
      txId: log.txId,
      authorPeerId: log.authorPeerId,
      logicalClock: log.logicalClock,
      committedAt: log.committedAt,
      schemaVersion: log.schemaVersion,
      reason: log.reason,
      txHash: log.txHash,
      entries,
    };
    await applyTransactionEnvelope(envelope, { persistLog: false });
  }
}

function initReplicationChannel() {
  window.addEventListener("beforeunload", () => {
    if (state.heartbeatTimer) {
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.presenceSweepTimer) {
      window.clearInterval(state.presenceSweepTimer);
      state.presenceSweepTimer = null;
    }
    if (state.rtcDiagTimer) {
      window.clearInterval(state.rtcDiagTimer);
      state.rtcDiagTimer = null;
    }
    if (state.peerjsHostConn) {
      state.peerjsHostConn.close();
      state.peerjsHostConn = null;
    }
    for (const conn of state.peerjsConns.values()) {
      conn.close();
    }
    state.peerjsConns.clear();
    if (state.peerjsPeer) {
      state.peerjsPeer.destroy();
      state.peerjsPeer = null;
    }
    if (state.replicationChannel) {
      state.replicationChannel.close();
      state.replicationChannel = null;
    }
    state.inboundTxChunks.clear();
  });

  if (window.Peer) {
    initPeerJsTransport().catch((error) => {
      console.warn("PeerJS init failed, fallback to BroadcastChannel", error);
      addReplicationEvent("transport-fallback", { reason: error.message || "peerjs-init-failed" });
      addIssue("warn", "PeerJS init failed, using BroadcastChannel fallback", {
        error: error.message || String(error),
      });
      initBroadcastTransport();
    });
  } else {
    addIssue("warn", "PeerJS not available, using BroadcastChannel fallback", {
      error: "peerjs-library-missing",
    });
    initBroadcastTransport();
  }

  announcePresence();
  state.heartbeatTimer = window.setInterval(() => {
    announcePresence();
  }, PEER_HEARTBEAT_MS);
  state.presenceSweepTimer = window.setInterval(() => {
    sweepPeerPresence();
  }, 2000);
  updatePeerStatus();

  refreshRtcDiagnostics();
  state.rtcDiagTimer = window.setInterval(() => {
    refreshRtcDiagnostics();
  }, 3000);
}

function initBroadcastTransport() {
  if (state.replicationChannel) {
    state.replicationChannel.close();
  }
  const channelName = `belsfe_session_${state.sessionId}`;
  state.replicationChannel = new BroadcastChannel(channelName);
  state.replicationChannel.addEventListener("message", (event) => {
    handleReplicationMessage(event.data).catch((error) => {
      console.error("Replication message failed", error);
    });
  });
  state.transportMode = "broadcast";
  addReplicationEvent("transport-ready", { reason: "broadcastchannel" });
}

async function initPeerJsTransport() {
  const hostId = buildHostPeerId(state.sessionId);
  state.peerjsHostId = hostId;

  try {
    const hostPeer = await openPeer(hostId);
    state.peerjsPeer = hostPeer;
    state.peerjsIsHost = true;
    state.transportMode = "peerjs-host";
    addReplicationEvent("transport-ready", { reason: "peerjs-host" });

    hostPeer.on("connection", (conn) => {
      setupHostSideConnection(conn);
    });

    hostPeer.on("error", (error) => {
      addReplicationEvent("transport-error", { error: error.message || String(error) });
      addIssue("error", "PeerJS host transport error", {
        error: error.message || String(error),
      });
    });
    return;
  } catch (error) {
    const errorType = String(error?.type || "");
    const unavailable = errorType === "unavailable-id" || String(error?.message || "").includes("unavailable");
    if (!unavailable) {
      throw error;
    }
  }

  const clientId = `${hostId}-${randomId().slice(0, 8)}`;
  const clientPeer = await openPeer(clientId);
  state.peerjsPeer = clientPeer;
  state.peerjsIsHost = false;
  state.transportMode = "peerjs-client";
  addReplicationEvent("transport-ready", { reason: "peerjs-client" });

  clientPeer.on("error", (error) => {
    addReplicationEvent("transport-error", { error: error.message || String(error) });
    addIssue("error", "PeerJS client transport error", {
      error: error.message || String(error),
    });
  });

  connectClientToHost(hostId);
}

function buildHostPeerId(sessionId) {
  const safe = String(sessionId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 24);
  return `belsfe-${safe}`;
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(id, {
      debug: 1,
      config: {
        iceServers: getConfiguredIceServers(),
      },
    });

    let settled = false;
    peer.on("open", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(peer);
    });

    peer.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      peer.destroy();
      reject(error);
    });
  });
}

function setupHostSideConnection(conn) {
  conn.on("open", () => {
    state.peerjsConns.set(conn.peer, conn);
    addReplicationEvent("peerjs-conn-open", { peerId: conn.peer });
  });

  conn.on("data", (message) => {
    handleReplicationMessage(message).catch((error) => {
      console.error("Replication message failed", error);
      addIssue("error", "Host failed to handle replication message", {
        error: error.message || String(error),
      });
    });

    // Host relays client messages to all other clients.
    for (const [peerId, peerConn] of state.peerjsConns.entries()) {
      if (peerId === conn.peer || !peerConn.open) {
        continue;
      }
      peerConn.send(message);
    }
  });

  conn.on("close", () => {
    state.peerjsConns.delete(conn.peer);
    addReplicationEvent("peerjs-conn-close", { peerId: conn.peer });
  });

  conn.on("error", (error) => {
    addReplicationEvent("peerjs-conn-error", { peerId: conn.peer, error: error.message || String(error) });
    addIssue("error", "PeerJS host-side connection error", {
      error: error.message || String(error),
      peerId: conn.peer,
    });
  });
}

function connectClientToHost(hostId) {
  if (!state.peerjsPeer) {
    return;
  }

  const conn = state.peerjsPeer.connect(hostId, {
    reliable: true,
    serialization: "json",
  });
  state.peerjsHostConn = conn;

  conn.on("open", () => {
    addReplicationEvent("peerjs-conn-open", { peerId: hostId });
    announcePresence();
  });

  conn.on("data", (message) => {
    handleReplicationMessage(message).catch((error) => {
      console.error("Replication message failed", error);
      addIssue("error", "Client failed to handle replication message", {
        error: error.message || String(error),
      });
    });
  });

  conn.on("close", () => {
    addReplicationEvent("peerjs-conn-close", { peerId: hostId });
    window.setTimeout(() => {
      if (!state.peerjsIsHost) {
        connectClientToHost(hostId);
      }
    }, 1500);
  });

  conn.on("error", (error) => {
    addReplicationEvent("peerjs-conn-error", { peerId: hostId, error: error.message || String(error) });
    addIssue("error", "PeerJS client connection error", {
      error: error.message || String(error),
      peerId: hostId,
    });
  });
}

function postReplicationMessage(payload) {
  if (state.transportMode === "peerjs-host") {
    let sent = false;
    for (const conn of state.peerjsConns.values()) {
      if (conn.open) {
        try {
          conn.send(payload);
          sent = true;
        } catch (_error) {
          // Keep sending to other open peers even if one fails.
        }
      }
    }
    return sent;
  }

  if (state.transportMode === "peerjs-client") {
    if (state.peerjsHostConn && state.peerjsHostConn.open) {
      try {
        state.peerjsHostConn.send(payload);
        return true;
      } catch (_error) {
        return false;
      }
    }
    return false;
  }

  if (state.transportMode === "broadcast" && state.replicationChannel) {
    state.replicationChannel.postMessage(payload);
    return true;
  }

  return false;
}

function announcePresence() {
  addReplicationEvent("heartbeat-send", { clock: state.logicalClock });
  postReplicationMessage({
    kind: "hello",
    fromPeerId: state.localPeerId,
    logicalClock: state.logicalClock,
  });
}

async function handleReplicationMessage(message) {
  if (!message || message.fromPeerId === state.localPeerId) {
    return;
  }

  markPeerSeen(message.fromPeerId);
  addReplicationEvent("heartbeat-seen", { peerId: message.fromPeerId, clock: message.logicalClock });

  if (message.kind === "hello") {
    if (state.logicalClock > (message.logicalClock || 0)) {
      await sendCatchupSince(message.logicalClock || 0, message.fromPeerId);
    }
    if ((message.logicalClock || 0) > state.logicalClock) {
      addReplicationEvent("catchup-request", {
        toPeerId: message.fromPeerId,
        sinceClock: state.logicalClock,
      });
      postReplicationMessage({
        kind: "catchup-request",
        fromPeerId: state.localPeerId,
        toPeerId: message.fromPeerId,
        sinceClock: state.logicalClock,
      });
    }
    return;
  }

  if (message.kind === "catchup-request") {
    if (message.toPeerId && message.toPeerId !== state.localPeerId) {
      return;
    }
    await sendCatchupSince(message.sinceClock || 0, message.fromPeerId);
    return;
  }

  if (message.kind === "tx") {
    await applyIncomingWireEnvelope(message);
    return;
  }

  if (message.kind === "tx-chunk") {
    await handleIncomingTxChunk(message);
  }
}

function markPeerSeen(peerId) {
  if (!peerId) {
    return;
  }
  state.peerPresence.set(peerId, Date.now());
  updatePeerStatus();
}

function sweepPeerPresence() {
  const now = Date.now();
  let changed = false;
  for (const [peerId, lastSeen] of state.peerPresence.entries()) {
    if (now - lastSeen > PEER_STALE_MS) {
      state.peerPresence.delete(peerId);
      changed = true;
    }
  }

  if (changed) {
    updatePeerStatus();
  }
}

function updatePeerStatus() {
  if (!ui.peerStatus) {
    return;
  }

  const peers = state.peerPresence.size;
  if (peers === 0) {
    ui.peerStatus.textContent = "No peer";
    ui.peerStatus.classList.remove("online");
    updatePeerTransferVisual();
    if (isConnectionPopoverOpen()) {
      renderConnectionPopover();
    }
    return;
  }

  ui.peerStatus.textContent = peers === 1 ? "1 peer connected" : `${peers} peers connected`;
  ui.peerStatus.classList.add("online");
  updatePeerTransferVisual();
  if (isConnectionPopoverOpen()) {
    renderConnectionPopover();
  }
}

function startChunkTransferProgress(txId, totalChunks) {
  state.chunkTransfer.active = true;
  state.chunkTransfer.txId = txId || null;
  state.chunkTransfer.sentChunks = 0;
  state.chunkTransfer.totalChunks = totalChunks;
  state.chunkTransfer.updatedAt = Date.now();
  updatePeerTransferVisual();
}

function advanceChunkTransferProgress(sentChunks) {
  if (!state.chunkTransfer.active) {
    return;
  }

  state.chunkTransfer.sentChunks = Math.max(0, Math.min(sentChunks, state.chunkTransfer.totalChunks));
  state.chunkTransfer.updatedAt = Date.now();
  updatePeerTransferVisual();
}

function finishChunkTransferProgress() {
  if (!state.chunkTransfer.active) {
    return;
  }

  state.chunkTransfer.active = false;
  state.chunkTransfer.lastTxId = state.chunkTransfer.txId;
  state.chunkTransfer.lastSentChunks = state.chunkTransfer.sentChunks;
  state.chunkTransfer.lastTotalChunks = state.chunkTransfer.totalChunks;
  state.chunkTransfer.txId = null;
  state.chunkTransfer.sentChunks = 0;
  state.chunkTransfer.totalChunks = 0;
  state.chunkTransfer.updatedAt = Date.now();
  updatePeerTransferVisual();
}

function startIncomingChunkTransferProgress(chunkId, txId, fromPeerId, totalChunks) {
  state.chunkTransferRx.active = true;
  state.chunkTransferRx.chunkId = chunkId || null;
  state.chunkTransferRx.txId = txId || null;
  state.chunkTransferRx.fromPeerId = fromPeerId || null;
  state.chunkTransferRx.receivedChunks = 0;
  state.chunkTransferRx.totalChunks = totalChunks;
  state.chunkTransferRx.updatedAt = Date.now();
  updatePeerTransferVisual();
}

function advanceIncomingChunkTransferProgress(chunkId, receivedChunks, totalChunks) {
  if (!state.chunkTransferRx.active || state.chunkTransferRx.chunkId !== chunkId) {
    return;
  }

  state.chunkTransferRx.receivedChunks = Math.max(0, Math.min(receivedChunks, totalChunks));
  state.chunkTransferRx.totalChunks = totalChunks;
  state.chunkTransferRx.updatedAt = Date.now();
  updatePeerTransferVisual();
}

function finishIncomingChunkTransferProgress(chunkId) {
  if (!state.chunkTransferRx.active || state.chunkTransferRx.chunkId !== chunkId) {
    return;
  }

  state.chunkTransferRx.active = false;
  state.chunkTransferRx.lastChunkId = state.chunkTransferRx.chunkId;
  state.chunkTransferRx.lastTxId = state.chunkTransferRx.txId;
  state.chunkTransferRx.lastFromPeerId = state.chunkTransferRx.fromPeerId;
  state.chunkTransferRx.lastReceivedChunks = state.chunkTransferRx.receivedChunks;
  state.chunkTransferRx.lastTotalChunks = state.chunkTransferRx.totalChunks;
  state.chunkTransferRx.chunkId = null;
  state.chunkTransferRx.txId = null;
  state.chunkTransferRx.fromPeerId = null;
  state.chunkTransferRx.receivedChunks = 0;
  state.chunkTransferRx.totalChunks = 0;
  state.chunkTransferRx.updatedAt = Date.now();
  updatePeerTransferVisual();
}

function getActiveChunkProgress() {
  const tx = state.chunkTransfer;
  const rx = state.chunkTransferRx;

  if (tx.active && rx.active) {
    return tx.updatedAt >= rx.updatedAt
      ? { direction: "send", current: tx.sentChunks, total: tx.totalChunks }
      : { direction: "receive", current: rx.receivedChunks, total: rx.totalChunks };
  }
  if (tx.active) {
    return { direction: "send", current: tx.sentChunks, total: tx.totalChunks };
  }
  if (rx.active) {
    return { direction: "receive", current: rx.receivedChunks, total: rx.totalChunks };
  }
  return null;
}

function updatePeerTransferVisual() {
  if (!ui.peerStatus) {
    return;
  }

  const activeProgress = getActiveChunkProgress();
  if (!activeProgress || activeProgress.total <= 0) {
    ui.peerStatus.classList.remove("transferring");
    ui.peerStatus.style.removeProperty("--peer-progress");
    if (isConnectionPopoverOpen()) {
      renderConnectionPopover();
    }
    return;
  }

  const ratio = activeProgress.current / activeProgress.total;
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  ui.peerStatus.classList.add("transferring");
  ui.peerStatus.style.setProperty("--peer-progress", `${pct}%`);
  if (isConnectionPopoverOpen()) {
    renderConnectionPopover();
  }
}

async function sendCatchupSince(sinceClock, targetPeerId) {
  const logs = await listTransactionLog();
  const pending = logs.filter((log) => (log.logicalClock || 0) > sinceClock);
  addReplicationEvent("catchup-send", { toPeerId: targetPeerId, count: pending.length, clock: state.logicalClock });
  for (const log of pending) {
    const entries = await getTransactionEntries(log.txId);
    const envelope = {
      txId: log.txId,
      authorPeerId: log.authorPeerId,
      logicalClock: log.logicalClock,
      committedAt: log.committedAt,
      schemaVersion: log.schemaVersion,
      reason: log.reason,
      meta: log.meta,
      txHash: log.txHash,
      entries,
    };
    await broadcastEnvelope(envelope, targetPeerId);
  }
}

async function broadcastEnvelope(envelope, targetPeerId) {
  if (!state.sessionId) {
    return;
  }

  const wireEnvelope = await serializeEnvelopeForWire(envelope);
  const key = await getTransportKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(wireEnvelope));
  const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  const txMessage = {
    kind: "tx",
    fromPeerId: state.localPeerId,
    toPeerId: targetPeerId,
    iv: bytesToBase64Url(iv),
    payload: bytesToBase64Url(new Uint8Array(encrypted)),
  };

  const sent = await postLargeTxMessage(txMessage, {
    txId: envelope.txId,
    toPeerId: targetPeerId,
    clock: envelope.logicalClock,
    reason: envelope.reason,
  });
  if (!sent) {
    addIssue("warn", "No active transport path for tx envelope", {
      error: "transport-not-ready",
    });
    return;
  }
  addReplicationEvent("tx-send", {
    txId: envelope.txId,
    toPeerId: targetPeerId,
    clock: envelope.logicalClock,
    reason: envelope.reason,
  });
}

async function postLargeTxMessage(txMessage, details = {}) {
  const serialized = JSON.stringify(txMessage);
  if (serialized.length <= TX_CHUNK_MAX_CHARS) {
    return postReplicationMessage(txMessage);
  }

  const chunkId = randomId();
  const chunks = splitStringBySize(serialized, TX_CHUNK_MAX_CHARS);
  startChunkTransferProgress(details.txId, chunks.length);
  addReplicationEvent("tx-chunk-send", {
    txId: details.txId,
    toPeerId: details.toPeerId,
    clock: details.clock,
    reason: details.reason,
    chunkId,
    chunks: chunks.length,
    bytes: serialized.length,
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const sent = postReplicationMessage({
      kind: "tx-chunk",
      fromPeerId: txMessage.fromPeerId,
      toPeerId: txMessage.toPeerId,
      txId: details.txId,
      chunkId,
      index,
      total: chunks.length,
      payloadChunk: chunks[index],
    });
    if (!sent) {
      finishChunkTransferProgress();
      return false;
    }
    advanceChunkTransferProgress(index + 1);

    // Yield every few chunks so the browser can paint progress updates.
    if ((index + 1) % 6 === 0) {
      await yieldForUi();
    }
  }

  finishChunkTransferProgress();
  return true;
}

function yieldForUi() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function splitStringBySize(text, maxChars) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += maxChars) {
    chunks.push(text.slice(offset, offset + maxChars));
  }
  return chunks;
}

async function handleIncomingTxChunk(message) {
  if (message.toPeerId && message.toPeerId !== state.localPeerId) {
    return;
  }

  sweepInboundTxChunks();
  const total = Number(message.total || 0);
  const index = Number(message.index || 0);
  if (!message.chunkId || !Number.isInteger(total) || !Number.isInteger(index) || total <= 0 || index < 0 || index >= total) {
    addIssue("warn", "Dropped malformed tx chunk", {
      error: "invalid-chunk-shape",
      peerId: message.fromPeerId,
    });
    return;
  }

  let buffer = state.inboundTxChunks.get(message.chunkId);
  if (!buffer) {
    buffer = {
      txId: message.txId,
      fromPeerId: message.fromPeerId,
      total,
      parts: new Array(total),
      received: 0,
      updatedAt: Date.now(),
    };
    state.inboundTxChunks.set(message.chunkId, buffer);
    startIncomingChunkTransferProgress(message.chunkId, message.txId, message.fromPeerId, total);
  }

  if (buffer.total !== total) {
    state.inboundTxChunks.delete(message.chunkId);
    finishIncomingChunkTransferProgress(message.chunkId);
    addIssue("warn", "Dropped inconsistent tx chunk stream", {
      error: "chunk-total-mismatch",
      peerId: message.fromPeerId,
    });
    return;
  }

  if (buffer.parts[index] === undefined) {
    buffer.parts[index] = String(message.payloadChunk || "");
    buffer.received += 1;
  }
  buffer.updatedAt = Date.now();
  advanceIncomingChunkTransferProgress(message.chunkId, buffer.received, buffer.total);

  if (buffer.received < buffer.total) {
    return;
  }

  state.inboundTxChunks.delete(message.chunkId);
  finishIncomingChunkTransferProgress(message.chunkId);
  const serialized = buffer.parts.join("");
  addReplicationEvent("tx-chunk-merge", {
    txId: buffer.txId,
    fromPeerId: buffer.fromPeerId,
    chunkId: message.chunkId,
    chunks: buffer.total,
    bytes: serialized.length,
  });

  const reconstructed = JSON.parse(serialized);
  await applyIncomingWireEnvelope(reconstructed);
}

function sweepInboundTxChunks() {
  const now = Date.now();
  for (const [chunkId, buffer] of state.inboundTxChunks.entries()) {
    if (now - buffer.updatedAt > TX_CHUNK_STALE_MS) {
      state.inboundTxChunks.delete(chunkId);
      finishIncomingChunkTransferProgress(chunkId);
      addIssue("warn", "Dropped stale tx chunk stream", {
        error: "chunk-timeout",
        peerId: buffer.fromPeerId,
      });
    }
  }
}

async function applyIncomingWireEnvelope(message) {
  if (message.toPeerId && message.toPeerId !== state.localPeerId) {
    return;
  }

  try {
    const key = await getTransportKey();
    const iv = base64UrlToBytes(message.iv);
    const cipher = base64UrlToBytes(message.payload);
    const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    const json = new TextDecoder().decode(new Uint8Array(decrypted));
    const envelope = await deserializeWireEnvelope(JSON.parse(json));

    addReplicationEvent("tx-receive", {
      txId: envelope.txId,
      fromPeerId: message.fromPeerId,
      clock: envelope.logicalClock,
      reason: envelope.reason,
    });

    if (state.seenTxIds.has(envelope.txId)) {
      addReplicationEvent("tx-skip", { txId: envelope.txId, reason: "already-seen" });
      return;
    }

    await applyTransactionEnvelope(envelope, { persistLog: true });
    state.seenTxIds.add(envelope.txId);
    state.logicalClock = Math.max(state.logicalClock, envelope.logicalClock || 0);
    addReplicationEvent("tx-apply", {
      txId: envelope.txId,
      entries: envelope.entries.length,
      clock: envelope.logicalClock,
      reason: envelope.reason,
    });
    await refreshNodes();
    render();
    await syncMetaState();
    if (isSettingsOpen()) {
      await renderTxLog();
    }
  } catch (error) {
    addReplicationEvent("tx-error", { error: error.message || String(error) });
    addIssue("error", "Failed to decrypt or apply incoming envelope", {
      error: error.message || String(error),
      peerId: message.fromPeerId,
    });
    throw error;
  }
}

function getHkdfBaseKey() {
  if (state.hkdfBaseKeyPromise) {
    return state.hkdfBaseKeyPromise;
  }

  state.hkdfBaseKeyPromise = (async () => {
    const material = new TextEncoder().encode(state.sessionId || "");
    return window.crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
  })();
  return state.hkdfBaseKeyPromise;
}

async function deriveAes128Key(infoLabel) {
  const baseKey = await getHkdfBaseKey();
  const salt = new TextEncoder().encode(KEY_DERIVATION_SALT);
  const info = new TextEncoder().encode(infoLabel);
  return window.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info,
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 128,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function getAtRestKey() {
  if (state.atRestKeyPromise) {
    return state.atRestKeyPromise;
  }

  state.atRestKeyPromise = deriveAes128Key(KEY_INFO_AT_REST);
  return state.atRestKeyPromise;
}

function getTransportKey() {
  if (state.transportKeyPromise) {
    return state.transportKeyPromise;
  }

  state.transportKeyPromise = deriveAes128Key(KEY_INFO_TRANSPORT);
  return state.transportKeyPromise;
}

async function serializeEnvelopeForWire(envelope) {
  const entries = [];
  for (const entry of envelope.entries) {
    const next = {
      order: entry.order,
      table: entry.table,
      action: entry.action,
      primaryKey: entry.primaryKey,
      meta: entry.meta,
    };

    if (entry.after) {
      next.after = {
        ...entry.after,
        content: await serializeContentForWire(entry.after.content, entry.after.mime),
      };
    }

    entries.push(next);
  }

  return {
    txId: envelope.txId,
    authorPeerId: envelope.authorPeerId,
    logicalClock: envelope.logicalClock,
    committedAt: envelope.committedAt,
    schemaVersion: envelope.schemaVersion,
    reason: envelope.reason,
    meta: envelope.meta,
    txHash: envelope.txHash,
    entries,
  };
}

async function deserializeWireEnvelope(wire) {
  const entries = [];
  for (const entry of wire.entries || []) {
    const next = {
      order: entry.order,
      table: entry.table,
      action: entry.action,
      primaryKey: entry.primaryKey,
      meta: entry.meta,
    };

    if (entry.after) {
      next.after = {
        ...entry.after,
        content: await deserializeContentFromWire(entry.after.content, entry.after.mime),
      };
    }

    entries.push(next);
  }

  return {
    txId: wire.txId,
    authorPeerId: wire.authorPeerId,
    logicalClock: wire.logicalClock,
    committedAt: wire.committedAt,
    schemaVersion: wire.schemaVersion,
    reason: wire.reason,
    meta: wire.meta,
    txHash: wire.txHash,
    entries,
  };
}

async function serializeContentForWire(content, mime) {
  if (content instanceof Blob) {
    const bytes = new Uint8Array(await content.arrayBuffer());
    return {
      kind: "blob",
      mime: mime || content.type || "application/octet-stream",
      data: bytesToBase64Url(bytes),
    };
  }

  if (typeof content === "string") {
    return {
      kind: "text",
      data: content,
    };
  }

  return {
    kind: "null",
  };
}

async function deserializeContentFromWire(payload, mime) {
  if (!payload || payload.kind === "null") {
    return null;
  }

  if (payload.kind === "text") {
    return payload.data || "";
  }

  if (payload.kind === "blob") {
    const bytes = base64UrlToBytes(payload.data || "");
    return new Blob([bytes], { type: payload.mime || mime || "application/octet-stream" });
  }

  return null;
}

function wireUi() {
  ui.newFolderBtn.addEventListener("click", onCreateFolder);
  ui.newFileBtn.addEventListener("click", onCreateTextFile);
  ui.renameBtn.addEventListener("click", onRenameNode);
  ui.deleteBtn.addEventListener("click", onDeleteNode);
  ui.saveBtn.addEventListener("click", saveEditorNow);
  ui.previewBtn.addEventListener("click", onTogglePreviewMode);
  ui.downloadBtn.addEventListener("click", onDownloadSelected);
  ui.editor.addEventListener("input", onEditorInput);
  ui.ctxDownloadBtn.addEventListener("click", onContextDownload);
  ui.ctxRenameBtn.addEventListener("click", onContextRename);
  ui.ctxDuplicateBtn.addEventListener("click", onContextDuplicate);
  ui.ctxDeleteBtn.addEventListener("click", onContextDelete);
  ui.settingsBtn.addEventListener("click", onToggleSettings);
  ui.settingsCloseBtn.addEventListener("click", hideSettings);
  ui.toggleSidebarBtn.addEventListener("click", onToggleSidebar);
  ui.themeSelect.addEventListener("change", onThemeChange);
  if (ui.saveIceServersBtn) {
    ui.saveIceServersBtn.addEventListener("click", onSaveIceServersConfig);
  }
  if (ui.resetIceServersBtn) {
    ui.resetIceServersBtn.addEventListener("click", onResetIceServersConfig);
  }
  ui.refreshTxLogBtn.addEventListener("click", onRefreshTxLog);
  ui.clearReplicationLogBtn.addEventListener("click", onClearReplicationLog);
  ui.clearIssuesBtn.addEventListener("click", onClearIssues);
  ui.copySessionBtn.addEventListener("click", onCopySessionLink);
  ui.copySessionBtn.addEventListener("mouseenter", onCopySessionBtnHover);
  ui.copySessionBtn.addEventListener("mouseleave", onCopySessionBtnLeave);
  ui.copySessionBtn.addEventListener("touchstart", onCopySessionBtnHover);
  ui.copySessionBtn.addEventListener("touchend", onCopySessionBtnLeave);

  if (ui.sessionTitle) {
    ui.sessionTitle.addEventListener("blur", onSessionTitleInput);
    ui.sessionTitle.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ui.sessionTitle.blur();
      }
    });
  }

  ui.peerStatus.tabIndex = 0;
  ui.peerStatus.addEventListener("mouseenter", showConnectionPopover);
  ui.peerStatus.addEventListener("mouseleave", hideConnectionPopover);
  ui.peerStatus.addEventListener("focus", showConnectionPopover);
  ui.peerStatus.addEventListener("blur", hideConnectionPopover);

  document.addEventListener("click", (e) => {
    hideContextMenu();
    // Hide QR code if clicking outside the copy button and popover
    if (!e.target.closest("#copySessionBtn") && !e.target.closest("#qrCodePopover")) {
      hideQrCodePopover();
    }
  });
  document.addEventListener("keydown", (event) => {
    // Esc key: close menus
    if (event.key === "Escape") {
      hideContextMenu();
      hideSettings();
      hideQrCodePopover();
      // Esc+p in edit mode: toggle to preview
      return;
    }
    
    // Esc+p in edit mode: toggle to preview
    if (event.key === "p" && event.ctrlKey && state.editorMode === "edit") {
      event.preventDefault();
      onTogglePreviewMode();
      return;
    }
    
    // "e" in preview mode: toggle to edit
    if (event.key === "e" && state.editorMode === "preview") {
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) {
        return;
      }
      event.preventDefault();
      onTogglePreviewMode();
      return;
    }
  });

  ui.importBtn.addEventListener("click", () => ui.importInput.click());
  ui.importFolderBtn.addEventListener("click", () => ui.importFolderInput.click());
  ui.importInput.addEventListener("change", onImportInput);
  ui.importFolderInput.addEventListener("change", onImportInput);

  ui.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("over");
  });

  ui.dropZone.addEventListener("dragleave", () => {
    ui.dropZone.classList.remove("over");
  });

  ui.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    ui.dropZone.classList.remove("over");
    await handleDrop(event);
  });
}

function onToggleSettings(event) {
  event.stopPropagation();
  if (isSettingsOpen()) {
    hideSettings();
    return;
  }
  showSettings();
}

function showSettings() {
  ui.settingsPanel.hidden = false;
  renderIceServersSettings();
  renderTxLog();
  renderReplicationLog();
  renderIssues();
}

function hideSettings() {
  ui.settingsPanel.hidden = true;
}

function isSettingsOpen() {
  return ui.settingsPanel && !ui.settingsPanel.hidden;
}

function onThemeChange(event) {
  const mode = event.target.value;
  if (mode !== "auto" && mode !== "light" && mode !== "dark") {
    return;
  }
  applyThemeMode(mode);
}

async function onRefreshTxLog() {
  await renderTxLog();
}

function onClearReplicationLog() {
  state.replicationEvents = [];
  renderReplicationLog();
}

function onClearIssues() {
  state.issues = [];
  renderIssues();
}

async function renderTxLog() {
  if (!ui.txLogList) {
    return;
  }

  const logs = await listTransactionLog();
  if (!logs.length) {
    ui.txLogList.innerHTML = `<div class="tx-log-meta">No transaction yet.</div>`;
    return;
  }

  const items = [];
  const ordered = logs.slice().reverse();
  for (const log of ordered) {
    const entries = await getTransactionEntries(log.txId);
    const summary = describeTransaction(log, entries);
    const when = formatDate(log.committedAt);
    items.push(`
      <div class="tx-log-item">
        <div class="tx-log-main">${escapeHtml(summary)}</div>
        <div class="tx-log-meta">${escapeHtml(when)} · clock ${log.logicalClock} · ${escapeHtml(log.reason || "unknown")}</div>
      </div>
    `);
  }

  ui.txLogList.innerHTML = items.join("");
}

function describeTransaction(log, entries) {
  const first = entries[0];
  if (log.reason === "nodes:create" && first?.after) {
    return `Created ${first.after.type} "${first.after.name}"`;
  }

  if (log.reason === "nodes:rename") {
    const previous = log.meta?.previousName || "item";
    const next = log.meta?.newName || "item";
    return `Renamed "${previous}" to "${next}"`;
  }

  if (log.reason === "nodes:move") {
    const name = log.meta?.name || "item";
    const from = log.meta?.from || "(unknown)";
    const to = log.meta?.to || "(unknown)";
    return `Moved "${name}" from "${from}" to "${to}"`;
  }

  if (log.reason === "nodes:delete-recursive") {
    const rootName = log.meta?.rootName || "item";
    const count = log.meta?.count || entries.length || 1;
    return `Deleted "${rootName}" and ${count - 1 >= 0 ? count - 1 : 0} child item(s)`;
  }

  if (log.reason === "nodes:text-save") {
    const name = log.meta?.name || first?.after?.name || "text file";
    return `Saved text file "${name}"`;
  }

  if (log.reason === "nodes:duplicate") {
    const source = log.meta?.sourceName || "item";
    const copy = log.meta?.copyName || first?.after?.name || "copy";
    return `Duplicated "${source}" as "${copy}"`;
  }

  if (log.reason === "nodes:import-file") {
    const name = log.meta?.name || first?.after?.name || "file";
    return `Imported file "${name}"`;
  }

  if (log.reason === "nodes:import-folder") {
    const name = log.meta?.name || first?.after?.name || "folder";
    return `Imported folder "${name}"`;
  }

  if (log.reason === "system:root-init") {
    return "Initialized root folder";
  }

  if (log.reason === "system:legacy-bootstrap") {
    return `Bootstrapped ${entries.length} node(s) into transaction history`;
  }

  if (log.reason === "meta:title-edit") {
    const title = first?.after?.value || "(empty)";
    return `Renamed session to "${title}"`;
  }

  if (first?.action === "upsert" && first.after) {
    if (first.table === STORE_META) {
      return `Updated meta "${first.primaryKey}"`;
    }
    return `Updated ${first.after.type} "${first.after.name}"`;
  }

  return `Applied ${entries.length} change(s)`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addReplicationEvent(kind, details) {
  const record = {
    id: randomId(),
    at: Date.now(),
    kind,
    details,
  };
  state.replicationEvents.unshift(record);
  if (state.replicationEvents.length > 200) {
    state.replicationEvents.length = 200;
  }
  if (isSettingsOpen()) {
    renderReplicationLog();
  }
  if (isConnectionPopoverOpen()) {
    renderConnectionPopover();
  }
}

function addIssue(level, message, details = {}) {
  const record = {
    id: randomId(),
    at: Date.now(),
    level,
    message,
    details,
  };
  state.issues.unshift(record);
  if (state.issues.length > 200) {
    state.issues.length = 200;
  }
  if (isSettingsOpen()) {
    renderIssues();
  }
}

function renderIssues() {
  if (!ui.issuesList) {
    return;
  }

  if (!state.issues.length) {
    ui.issuesList.innerHTML = `<div class="tx-log-meta">No issue recorded.</div>`;
    return;
  }

  const items = state.issues.map((issue) => {
    const when = formatDate(issue.at);
    const levelClass = issue.level === "error" ? "error" : "warn";
    const levelLabel = issue.level === "error" ? "error" : "warning";
    const detailBits = [];
    if (state.transportMode) {
      detailBits.push(`mode ${state.transportMode}`);
    }
    if (issue.details.peerId) {
      detailBits.push(`peer ${shortPeer(issue.details.peerId)}`);
    }
    if (issue.details.error) {
      detailBits.push(issue.details.error);
    }

    return `
      <div class="tx-log-item">
        <div class="tx-log-main"><span class="tx-log-kind ${levelClass}">${escapeHtml(levelLabel)}</span>${escapeHtml(issue.message)}</div>
        <div class="tx-log-meta">${escapeHtml(when)} · ${escapeHtml(detailBits.join(" · ") || "n/a")}</div>
      </div>
    `;
  });

  ui.issuesList.innerHTML = items.join("");
}

function renderReplicationLog() {
  if (!ui.replicationLogList) {
    return;
  }

  if (!state.replicationEvents.length) {
    ui.replicationLogList.innerHTML = `<div class="tx-log-meta">No replication event yet.</div>`;
    return;
  }

  const items = state.replicationEvents.map((event) => {
    const when = formatDate(event.at);
    const main = replicationEventMain(event);
    const meta = replicationEventMeta(event);
    return `
      <div class="tx-log-item">
        <div class="tx-log-main"><span class="tx-log-kind">${escapeHtml(event.kind)}</span>${escapeHtml(main)}</div>
        <div class="tx-log-meta">${escapeHtml(when)} · ${escapeHtml(meta)}</div>
      </div>
    `;
  });

  ui.replicationLogList.innerHTML = items.join("");
}

function replicationEventMain(event) {
  const d = event.details || {};
  if (event.kind === "transport-ready") {
    return `Transport ready (${d.reason || "unknown"})`;
  }
  if (event.kind === "transport-fallback") {
    return `Transport fallback engaged (${d.reason || "unknown"})`;
  }
  if (event.kind === "transport-error") {
    return "Transport error";
  }
  if (event.kind === "peerjs-conn-open") {
    return `PeerJS data connection open with ${shortPeer(d.peerId)}`;
  }
  if (event.kind === "peerjs-conn-close") {
    return `PeerJS data connection closed with ${shortPeer(d.peerId)}`;
  }
  if (event.kind === "peerjs-conn-error") {
    return `PeerJS data connection error with ${shortPeer(d.peerId)}`;
  }
  if (event.kind === "heartbeat-send") {
    return `Presence heartbeat sent (clock ${d.clock})`;
  }
  if (event.kind === "heartbeat-seen") {
    return `Presence seen from ${shortPeer(d.peerId)}`;
  }
  if (event.kind === "catchup-request") {
    return `Catch-up requested from ${shortPeer(d.toPeerId)} since clock ${d.sinceClock}`;
  }
  if (event.kind === "catchup-send") {
    return `Catch-up sent to ${shortPeer(d.toPeerId)} (${d.count} tx)`;
  }
  if (event.kind === "tx-send") {
    return `Envelope sent ${shortTx(d.txId)}${d.toPeerId ? ` to ${shortPeer(d.toPeerId)}` : ""}`;
  }
  if (event.kind === "tx-chunk-send") {
    return `Envelope chunked ${shortTx(d.txId)} (${d.chunks} chunks)`;
  }
  if (event.kind === "tx-chunk-merge") {
    return `Envelope reassembled ${shortTx(d.txId)} (${d.chunks} chunks)`;
  }
  if (event.kind === "tx-receive") {
    return `Envelope received ${shortTx(d.txId)} from ${shortPeer(d.fromPeerId)}`;
  }
  if (event.kind === "tx-apply") {
    return `Envelope applied ${shortTx(d.txId)} (${d.entries} entries)`;
  }
  if (event.kind === "tx-skip") {
    return `Envelope skipped ${shortTx(d.txId)} (${d.reason})`;
  }
  if (event.kind === "tx-error") {
    return `Envelope processing failed`;
  }
  return "Replication event";
}

function replicationEventMeta(event) {
  const d = event.details || {};
  const bits = [];
  if (state.transportMode) {
    bits.push(`mode ${state.transportMode}`);
  }
  if (d.clock !== undefined) {
    bits.push(`clock ${d.clock}`);
  }
  if (d.reason) {
    bits.push(d.reason);
  }
  if (d.error) {
    bits.push(d.error);
  }
  if (d.chunks !== undefined) {
    bits.push(`${d.chunks} chunks`);
  }
  if (d.bytes !== undefined) {
    bits.push(`${d.bytes} bytes`);
  }
  return bits.join(" · ") || "ok";
}

function shortPeer(peerId) {
  if (!peerId) {
    return "peer";
  }
  return peerId.slice(0, 6);
}

function shortTx(txId) {
  if (!txId) {
    return "tx";
  }
  return txId.slice(0, 8);
}

function showConnectionPopover() {
  if (!ui.connectionPopover) {
    return;
  }
  renderConnectionPopover();
  ui.connectionPopover.hidden = false;
}

function hideConnectionPopover() {
  if (!ui.connectionPopover) {
    return;
  }
  ui.connectionPopover.hidden = true;
}

function isConnectionPopoverOpen() {
  return !!ui.connectionPopover && !ui.connectionPopover.hidden;
}

function onCopySessionBtnHover() {
  if (state.qrCodeHoverTimer) {
    return;
  }
  state.qrCodeHoverTimer = setTimeout(() => {
    showQrCodePopover();
    state.qrCodeHoverTimer = null;
  }, 4000);
}

function onCopySessionBtnLeave() {
  if (state.qrCodeHoverTimer) {
    clearTimeout(state.qrCodeHoverTimer);
    state.qrCodeHoverTimer = null;
  }
  hideQrCodePopover();
}

function showQrCodePopover() {
  const sessionUrl = state.sessionUrl || window.location.toString();
  if (!sessionUrl || !ui.qrCodePopover || !ui.qrCodeContainer) {
    return;
  }
  
  // Clear previous QR code
  ui.qrCodeContainer.innerHTML = "";
  
  // Generate QR code using QRCode library (must be included in HTML)
  if (typeof QRCode !== "undefined") {
    try {
      new QRCode(ui.qrCodeContainer, {
        text: sessionUrl,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H,
      });
    } catch (err) {
      ui.qrCodeContainer.innerHTML = "<p>QR code error</p>";
      console.error("QR code generation failed:", err);
    }
  } else {
    ui.qrCodeContainer.innerHTML = "<p>QR library not loaded</p>";
  }
  
  // Position popover near copy button
  const rect = ui.copySessionBtn.getBoundingClientRect();
  ui.qrCodePopover.style.top = (rect.bottom + 10) + "px";
  ui.qrCodePopover.style.left = (rect.left - 110) + "px";
  ui.qrCodePopover.hidden = false;
}

function hideQrCodePopover() {
  if (!ui.qrCodePopover || !ui.qrCodeContainer) {
    return;
  }
  ui.qrCodePopover.hidden = true;
  ui.qrCodeContainer.innerHTML = "";
}

function renderConnectionPopover() {
  if (!ui.connectionPopover) {
    return;
  }

  const lines = getConnectionDiagnosticsLines();
  const html = [
    `<div class="connection-popover-title">Connection Diagnostics</div>`,
    ...lines.map(
      (line) =>
        `<div class="connection-popover-line" data-level="${line.level}">${escapeHtml(line.text)}</div>`
    ),
  ].join("");
  ui.connectionPopover.innerHTML = html;
}

function getConnectionDiagnosticsLines() {
  const transport = state.transportMode || "none";
  const peerCount = state.peerPresence.size;
  const role = state.peerjsIsHost ? "host" : "client";
  const hostOpen = !!(state.peerjsHostConn && state.peerjsHostConn.open);
  const openPeerJsConns = countOpenPeerJsConns();
  const hasPeerJs = typeof window.Peer === "function";
  const configuredIceServers = getConfiguredIceServers();
  const allIceUrls = configuredIceServers.flatMap((server) =>
    Array.isArray(server.urls) ? server.urls : [server.urls]
  );
  const stunConfigured = allIceUrls.some((url) => /^stun:/i.test(String(url || "")));
  const turnConfigured = allIceUrls.some((url) => /^(turn:|turns:)/i.test(String(url || "")));
  const relayState = state.rtcDiagnostics.relayState || "unknown";
  const candidateTypes = state.rtcDiagnostics.candidateTypes || "n/a";
  const recent = state.replicationEvents[0];
  const webrtcActive = openPeerJsConns > 0 || hostOpen;
  const usingFallback = transport === "broadcast";
  const transportReady = transport !== "none";
  const chunkActive = state.chunkTransfer.active;
  const chunkSent = chunkActive ? state.chunkTransfer.sentChunks : state.chunkTransfer.lastSentChunks;
  const chunkTotal = chunkActive ? state.chunkTransfer.totalChunks : state.chunkTransfer.lastTotalChunks;
  const chunkStatus = chunkActive
    ? "in progress"
    : chunkTotal === 0
      ? "idle"
      : chunkSent >= chunkTotal
        ? "completed"
        : "interrupted";
  const chunkRxActive = state.chunkTransferRx.active;
  const chunkReceived = chunkRxActive ? state.chunkTransferRx.receivedChunks : state.chunkTransferRx.lastReceivedChunks;
  const chunkRxTotal = chunkRxActive ? state.chunkTransferRx.totalChunks : state.chunkTransferRx.lastTotalChunks;
  const chunkRxStatus = chunkRxActive
    ? "in progress"
    : chunkRxTotal === 0
      ? "idle"
      : chunkReceived >= chunkRxTotal
        ? "completed"
        : "interrupted";

  const lines = [];
  lines.push({
    text: `Transport mode: ${transport}`,
    level: transportReady ? "ok" : "error",
  });
  lines.push({
    text: `PeerJS library: ${hasPeerJs ? "loaded" : "missing"}`,
    level: hasPeerJs ? "ok" : "warn",
  });
  lines.push({
    text: `PeerJS role: ${role}`,
    level: hasPeerJs ? "ok" : "warn",
  });
  lines.push({
    text: `PeerJS open links: ${openPeerJsConns}${hostOpen ? " (+host link)" : ""}`,
    level: webrtcActive ? "ok" : hasPeerJs ? "warn" : "error",
  });
  lines.push({
    text: `WebRTC data path: ${webrtcActive ? "active" : "idle"}`,
    level: webrtcActive ? "ok" : "warn",
  });
  lines.push({
    text: `Peers seen: ${peerCount}`,
    level: peerCount > 0 ? "ok" : "warn",
  });
  lines.push({
    text: `STUN configured (this tab): ${stunConfigured ? "yes" : "no"}`,
    level: stunConfigured ? "ok" : "warn",
  });
  lines.push({
    text: `TURN configured (this tab): ${turnConfigured ? "yes" : "no"}`,
    level: turnConfigured ? "ok" : "warn",
  });
  lines.push({
    text: `TURN relay path: ${relayState}`,
    level: relayState === "active" ? "ok" : relayState === "not-active" ? "warn" : "warn",
  });
  lines.push({
    text: `Selected candidate type(s): ${candidateTypes}`,
    level: candidateTypes === "n/a" ? "warn" : "ok",
  });
  lines.push({
    text: `Fallback channel: ${usingFallback ? "active" : "inactive"}`,
    level: usingFallback ? "warn" : "ok",
  });
  lines.push({
    text: `Chunks sent: ${chunkSent}`,
    level: chunkTotal > 0 && chunkSent < chunkTotal ? "warn" : chunkTotal > 0 ? "ok" : "warn",
  });
  lines.push({
    text: `Chunks total (send): ${chunkTotal}`,
    level: chunkTotal > 0 ? "ok" : "warn",
  });
  lines.push({
    text: `Chunk send: ${chunkStatus}`,
    level: chunkStatus === "completed" ? "ok" : chunkStatus === "idle" ? "warn" : "warn",
  });
  lines.push({
    text: `Chunks received: ${chunkReceived}`,
    level: chunkRxTotal > 0 && chunkReceived < chunkRxTotal ? "warn" : chunkRxTotal > 0 ? "ok" : "warn",
  });
  lines.push({
    text: `Chunks total (recv): ${chunkRxTotal}`,
    level: chunkRxTotal > 0 ? "ok" : "warn",
  });
  lines.push({
    text: `Chunk receive: ${chunkRxStatus}`,
    level: chunkRxStatus === "completed" ? "ok" : chunkRxStatus === "idle" ? "warn" : "warn",
  });
  if (recent) {
    lines.push({
      text: `Last event: ${recent.kind} at ${formatDate(recent.at)}`,
      level: recent.kind.includes("error") ? "error" : recent.kind.includes("fallback") ? "warn" : "ok",
    });
  }
  lines.push({
    text: `Session: ${state.sessionId ? `${state.sessionId.slice(0, 12)}...` : "n/a"}`,
    level: "ok",
  });

  return lines;
}

async function refreshRtcDiagnostics() {
  const result = {
    relayState: "unknown",
    candidateTypes: "n/a",
    updatedAt: Date.now(),
    error: null,
  };

  try {
    const peerConnections = collectOpenPeerConnections();
    if (!peerConnections.length) {
      result.relayState = "idle";
      state.rtcDiagnostics = result;
      if (isConnectionPopoverOpen()) {
        renderConnectionPopover();
      }
      return;
    }

    const candidateTypes = new Set();
    let hasSelectedPair = false;
    let hasRelay = false;

    for (const pc of peerConnections) {
      const stats = await pc.getStats();
      const reportById = new Map();
      stats.forEach((report) => {
        reportById.set(report.id, report);
      });

      stats.forEach((report) => {
        if (report.type !== "candidate-pair") {
          return;
        }
        const selected = report.nominated || report.selected || report.state === "succeeded";
        if (!selected) {
          return;
        }

        const local = reportById.get(report.localCandidateId);
        const remote = reportById.get(report.remoteCandidateId);
        const localType = local && local.candidateType ? String(local.candidateType) : "";
        const remoteType = remote && remote.candidateType ? String(remote.candidateType) : "";

        if (!localType && !remoteType) {
          return;
        }

        hasSelectedPair = true;
        if (localType) {
          candidateTypes.add(`local:${localType}`);
        }
        if (remoteType) {
          candidateTypes.add(`remote:${remoteType}`);
        }
        if (localType === "relay" || remoteType === "relay") {
          hasRelay = true;
        }
      });
    }

    if (candidateTypes.size > 0) {
      result.candidateTypes = Array.from(candidateTypes).sort().join(", ");
    }
    if (hasRelay) {
      result.relayState = "active";
    } else if (hasSelectedPair) {
      result.relayState = "not-active";
    } else {
      result.relayState = "unknown";
    }
  } catch (error) {
    result.relayState = "unknown";
    result.error = error && error.message ? error.message : String(error);
  }

  state.rtcDiagnostics = result;
  if (isConnectionPopoverOpen()) {
    renderConnectionPopover();
  }
}

function collectOpenPeerConnections() {
  const pcs = [];

  const pushFromConn = (conn) => {
    if (!conn || !conn.open) {
      return;
    }
    const pc = conn.peerConnection || conn._pc;
    if (pc && typeof pc.getStats === "function") {
      pcs.push(pc);
    }
  };

  pushFromConn(state.peerjsHostConn);
  for (const conn of state.peerjsConns.values()) {
    pushFromConn(conn);
  }

  return pcs;
}

function countOpenPeerJsConns() {
  let count = 0;
  for (const conn of state.peerjsConns.values()) {
    if (conn.open) {
      count += 1;
    }
  }
  return count;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getSelectedNode() {
  return state.nodes.find((n) => n.id === state.selectedId) || null;
}

function getTargetFolderId() {
  const selected = getSelectedNode();
  if (!selected) {
    return ROOT_ID;
  }
  return selected.type === "folder" ? selected.id : selected.parentId || ROOT_ID;
}

function randomId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function createNode(node) {
  await commitLocalNodeEntries([makeUpsertEntry(node)], "nodes:create", {
    name: node.name,
    nodeType: node.type,
  });
}

async function updateNode(node, reason = "nodes:update", meta = {}) {
  await commitLocalNodeEntries([makeUpsertEntry(node)], reason, meta);
}

async function deleteNodeRecursive(id, rootName = "item") {
  const ids = collectDescendantIds(id);
  const entries = ids.map((nodeId) => makeDeleteEntry(nodeId));
  await commitLocalNodeEntries(entries, "nodes:delete-recursive", {
    rootName,
    count: ids.length,
  });
}

async function onCreateFolder() {
  const name = getCreateName("New folder");

  const node = {
    id: randomId(),
    parentId: getTargetFolderId(),
    type: "folder",
    name,
    mime: null,
    content: null,
    updatedAt: Date.now(),
    size: 0,
  };

  await createNode(node);
  state.expanded.add(node.parentId);
  await refreshNodes();
  render();
}

async function onCreateTextFile() {
  const name = getCreateName("note.txt");

  const node = {
    id: randomId(),
    parentId: getTargetFolderId(),
    type: "file",
    name,
    mime: "text/plain",
    content: "",
    updatedAt: Date.now(),
    size: 0,
  };

  await createNode(node);
  state.expanded.add(node.parentId);
  state.selectedId = node.id;
  await refreshNodes();
  render();
}

function getCreateName(fallback) {
  const raw = (ui.createName?.value || "").trim();
  const value = raw || fallback;
  if (ui.createName) {
    ui.createName.value = value;
  }
  return value;
}

async function onRenameNode() {
  const selected = getSelectedNode();
  if (!selected || selected.id === ROOT_ID) {
    return;
  }

  const nextName = window.prompt("New name:", selected.name);
  if (!nextName) {
    return;
  }

  const previousName = selected.name;
  selected.name = nextName.trim();
  if (!selected.name) {
    return;
  }
  selected.updatedAt = Date.now();
  await updateNode(selected, "nodes:rename", {
    previousName,
    newName: selected.name,
    nodeType: selected.type,
  });
  await refreshNodes();
  render();
}

async function onDeleteNode() {
  const selected = getSelectedNode();
  if (!selected || selected.id === ROOT_ID) {
    return;
  }

  const confirmed = window.confirm(`Delete ${selected.name} and nested children?`);
  if (!confirmed) {
    return;
  }

  const fallback = selected.parentId || ROOT_ID;
  await deleteNodeRecursive(selected.id, selected.name);
  state.selectedId = fallback;
  await refreshNodes();
  render();
}

async function moveFileToFolder(sourceId, targetFolderId) {
  const source = state.nodes.find((n) => n.id === sourceId);
  const target = state.nodes.find((n) => n.id === targetFolderId);
  if (!source || !target || source.type !== "file" || target.type !== "folder") {
    return;
  }

  if (source.parentId === targetFolderId) {
    return;
  }

  const fromFolder = state.nodes.find((n) => n.id === source.parentId);
  source.parentId = targetFolderId;
  source.updatedAt = Date.now();
  await updateNode(source, "nodes:move", {
    name: source.name,
    from: fromFolder?.name || "Shared",
    to: target.name,
  });
  state.expanded.add(targetFolderId);
  state.selectedId = source.id;
  await refreshNodes();
  render();
}

function onDownloadSelected() {
  const node = getSelectedNode();
  if (!node || node.type !== "file") {
    return;
  }
  downloadNode(node, true);
}

function onContextDownload() {
  const node = state.nodes.find((n) => n.id === state.contextNodeId);
  hideContextMenu();
  if (!node || node.type !== "file") {
    return;
  }
  downloadNode(node, false);
}

async function onContextRename() {
  const node = state.nodes.find((n) => n.id === state.contextNodeId);
  hideContextMenu();
  if (!node || node.id === ROOT_ID) {
    return;
  }

  const nextName = window.prompt("New name:", node.name);
  if (!nextName) {
    return;
  }

  const previousName = node.name;
  node.name = nextName.trim();
  if (!node.name) {
    return;
  }
  node.updatedAt = Date.now();
  await updateNode(node, "nodes:rename", {
    previousName,
    newName: node.name,
    nodeType: node.type,
  });
  state.selectedId = node.id;
  await refreshNodes();
  render();
}

async function onContextDuplicate() {
  const node = state.nodes.find((n) => n.id === state.contextNodeId);
  hideContextMenu();
  if (!node || node.id === ROOT_ID) {
    return;
  }

  await duplicateNodeRecursive(node.id, node.parentId || ROOT_ID);
  await refreshNodes();
  render();
}

async function onContextDelete() {
  const node = state.nodes.find((n) => n.id === state.contextNodeId);
  hideContextMenu();
  if (!node || node.id === ROOT_ID) {
    return;
  }

  const confirmed = window.confirm(`Delete ${node.name} and nested children?`);
  if (!confirmed) {
    return;
  }

  const fallback = node.parentId || ROOT_ID;
  await deleteNodeRecursive(node.id, node.name);
  state.selectedId = fallback;
  await refreshNodes();
  render();
}

async function duplicateNodeRecursive(sourceId, targetParentId) {
  const source = state.nodes.find((n) => n.id === sourceId);
  if (!source) {
    return null;
  }

  const baseName = source.name;
  const copyName = uniqueSiblingName(targetParentId, baseName);
  const now = Date.now();
  const newNode = {
    ...source,
    id: randomId(),
    parentId: targetParentId,
    name: copyName,
    updatedAt: now,
  };

  if (newNode.type === "file" && newNode.content instanceof Blob) {
    newNode.content = newNode.content.slice(0, newNode.content.size, newNode.content.type || undefined);
  }

  await commitLocalNodeEntries([makeUpsertEntry(newNode)], "nodes:duplicate", {
    sourceName: source.name,
    copyName: newNode.name,
    nodeType: source.type,
  });
  state.nodes.push(newNode);

  if (source.type === "folder") {
    const children = state.nodes
      .filter((n) => n.parentId === source.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      await duplicateNodeRecursive(child.id, newNode.id);
    }
    state.expanded.add(newNode.id);
  }

  return newNode.id;
}

function uniqueSiblingName(parentId, desiredName) {
  const siblings = state.nodes.filter((n) => n.parentId === parentId).map((n) => n.name);
  if (!siblings.includes(desiredName)) {
    return desiredName;
  }

  let counter = 1;
  while (siblings.includes(`${desiredName} (${counter})`)) {
    counter += 1;
  }
  return `${desiredName} (${counter})`;
}

function downloadNode(node, allowEditorContent) {
  let blob;

  if (isTextFile(node)) {
    const useEditor = allowEditorContent && state.selectedId === node.id && !ui.editor.disabled;
    const text = useEditor ? ui.editor.value : typeof node.content === "string" ? node.content : "";
    blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  } else if (node.content instanceof Blob) {
    blob = node.content;
  } else if (typeof node.content === "string") {
    blob = new Blob([node.content], { type: node.mime || "application/octet-stream" });
  } else {
    window.alert("Cannot download this file yet.");
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = node.name || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function showContextMenu(event, node) {
  const menu = ui.contextMenu;
  if (!menu) {
    return;
  }

  if (ui.ctxDownloadBtn) {
    ui.ctxDownloadBtn.disabled = node.type !== "file";
  }

  state.contextNodeId = node.id;
  menu.hidden = false;

  const margin = 8;
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;

  let left = event.clientX;
  let top = event.clientY;

  if (left + menuWidth + margin > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - menuWidth - margin);
  }

  if (top + menuHeight + margin > window.innerHeight) {
    top = Math.max(margin, event.clientY - menuHeight);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideContextMenu() {
  const menu = ui.contextMenu;
  if (!menu) {
    return;
  }
  menu.hidden = true;
  state.contextNodeId = null;
}

function onEditorInput() {
  const selected = getSelectedNode();
  if (!selected || selected.type !== "file" || !isTextFile(selected)) {
    return;
  }

  selected.content = ui.editor.value;
  selected.size = selected.content.length;
  selected.updatedAt = Date.now();
  ui.editorMeta.textContent = "Unsaved changes...";
  if (isMarkdownNode(selected)) {
    renderMarkdownPreview(selected.content);
  }

  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
  }
  state.saveTimer = window.setTimeout(() => {
    state.saveTimer = null;
    saveEditorNow();
  }, EDITOR_SAVE_DEBOUNCE_MS);
}

function flushPendingEditorSave() {
  if (!state.saveTimer) {
    return;
  }
  window.clearTimeout(state.saveTimer);
  state.saveTimer = null;
  saveEditorNow();
}

async function saveEditorNow() {
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  const selected = getSelectedNode();
  if (!selected || selected.type !== "file" || !isTextFile(selected)) {
    return;
  }

  await updateNode(selected, "nodes:text-save", {
    name: selected.name,
    size: selected.size,
  });
  ui.editorMeta.textContent = `Saved · ${formatDate(selected.updatedAt)} · ${selected.size} chars`;
  await refreshNodes();
  renderTree();
}

async function onImportInput(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }
  await importFiles(files);
  event.target.value = "";
}

async function handleDrop(event) {
  const dt = event.dataTransfer;
  if (!dt) {
    return;
  }

  const files = Array.from(dt.files || []);
  if (files.length) {
    await importFiles(files);
  }
}

async function importFiles(files, baseFolderId = getTargetFolderId()) {
  for (const file of files) {
    const relPath = file.webkitRelativePath || file.name;
    const segments = relPath.split("/").filter(Boolean);
    const folders = segments.slice(0, -1);
    const filename = segments[segments.length - 1] || file.name;
    const parentId = await ensureFolderPath(baseFolderId, folders);
    await importSingleFile(parentId, filename, file);
  }

  await refreshNodes();
  render();
}

async function ensureFolderPath(baseParentId, folders) {
  let currentParentId = baseParentId;

  for (const folderName of folders) {
    let folder = state.nodes.find(
      (n) => n.parentId === currentParentId && n.type === "folder" && n.name === folderName
    );

    if (!folder) {
      folder = {
        id: randomId(),
        parentId: currentParentId,
        type: "folder",
        name: folderName,
        mime: null,
        content: null,
        updatedAt: Date.now(),
        size: 0,
      };
      await commitLocalNodeEntries([makeUpsertEntry(folder)], "nodes:import-folder", {
        name: folder.name,
      });
      state.nodes.push(folder);
    }

    state.expanded.add(folder.id);
    currentParentId = folder.id;
  }

  return currentParentId;
}

async function importSingleFile(parentId, name, file) {
  const resolvedName = uniqueImportedFileName(parentId, name);
  const isText = file.type.startsWith("text/") || /\.(txt|md|json|js|ts|css|html)$/i.test(resolvedName);
  let content;

  if (isText) {
    content = await file.text();
  } else {
    content = file;
  }

  const node = {
    id: randomId(),
    parentId,
    type: "file",
    name: resolvedName,
    mime: file.type || "application/octet-stream",
    content,
    updatedAt: Date.now(),
    size: file.size,
  };

  await commitLocalNodeEntries([makeUpsertEntry(node)], "nodes:import-file", {
    name: node.name,
    size: node.size,
  });
  state.nodes.push(node);
}

function uniqueImportedFileName(parentId, desiredName) {
  const siblings = state.nodes.filter((n) => n.parentId === parentId && n.type === "file").map((n) => n.name);
  if (!siblings.includes(desiredName)) {
    return desiredName;
  }

  const { base, ext } = splitFileNameExt(desiredName);
  let counter = 1;
  let candidate = `${base} (${counter})${ext}`;
  while (siblings.includes(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
}

function splitFileNameExt(filename) {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) {
    return {
      base: filename,
      ext: "",
    };
  }

  return {
    base: filename.slice(0, lastDot),
    ext: filename.slice(lastDot),
  };
}

function render() {
  syncHashWithState();
  renderTree();
  renderRecentFiles();
  renderEditor();
}

function renderRecentFiles() {
  ui.recentList.innerHTML = "";

  const recent = state.nodes
    .filter((node) => node.type === "file")
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, RECENT_FILES_LIMIT);

  if (!recent.length) {
    const empty = document.createElement("li");
    empty.className = "recent-empty";
    empty.textContent = "No files yet";
    ui.recentList.appendChild(empty);
    return;
  }

  for (const node of recent) {
    const li = document.createElement("li");

    const row = document.createElement("button");
    row.type = "button";
    row.className = `recent-row${state.selectedId === node.id ? " selected" : ""}`;

    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = node.name;

    const meta = document.createElement("span");
    meta.className = "recent-meta";
    meta.textContent = formatDate(node.updatedAt);

    row.appendChild(name);
    row.appendChild(meta);
    row.addEventListener("click", () => {
      hideContextMenu();
      flushPendingEditorSave();
      state.selectedId = node.id;
      render();
    });

    li.appendChild(row);
    ui.recentList.appendChild(li);
  }
}

function renderTree() {
  ui.tree.innerHTML = "";

  const childrenByParent = new Map();
  for (const node of state.nodes) {
    const key = node.parentId || "__root__";
    if (!childrenByParent.has(key)) {
      childrenByParent.set(key, []);
    }
    childrenByParent.get(key).push(node);
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  const root = state.nodes.find((n) => n.id === ROOT_ID);
  if (!root) {
    return;
  }

  const rootChildren = childrenByParent.get(ROOT_ID) || [];
  const rootLi = createTreeItem(root, 0, rootChildren.length > 0);
  ui.tree.appendChild(rootLi);

  if (state.expanded.has(ROOT_ID)) {
    appendChildren(rootLi, ROOT_ID, 1, childrenByParent);
  }
}

function appendChildren(container, parentId, depth, childrenByParent) {
  const children = childrenByParent.get(parentId) || [];
  if (!children.length) {
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "tree";
  ul.style.paddingLeft = "12px";

  for (const child of children) {
    const hasChildren = (childrenByParent.get(child.id) || []).length > 0;
    const li = createTreeItem(child, depth, hasChildren);
    ul.appendChild(li);

    if (child.type === "folder" && state.expanded.has(child.id)) {
      appendChildren(li, child.id, depth + 1, childrenByParent);
    }
  }

  container.appendChild(ul);
}

function createTreeItem(node, depth, hasChildren) {
  const li = document.createElement("li");
  li.className = "tree-item";

  const row = document.createElement("button");
  row.type = "button";
  row.className = `tree-row tree-row-${node.type}${state.selectedId === node.id ? " selected" : ""}`;
  row.style.paddingLeft = `${8 + depth * 10}px`;

  const twist = document.createElement("span");
  twist.className = "twist";
  twist.textContent = node.type === "folder" ? (state.expanded.has(node.id) && hasChildren ? "▾" : "▸") : "";

  const label = document.createElement("span");
  label.textContent = node.name;

  row.appendChild(twist);
  row.appendChild(label);

  if (node.type === "file") {
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      state.dragNodeId = node.id;
      row.classList.add("drag-source");
      hideContextMenu();
      if (event.dataTransfer) {
        event.dataTransfer.setData("text/plain", node.id);
        event.dataTransfer.effectAllowed = "move";
      }
    });

    row.addEventListener("dragend", () => {
      state.dragNodeId = null;
      row.classList.remove("drag-source");
      clearTreeDropTargets();
    });
  }

  if (node.type === "folder") {
    row.addEventListener("dragover", (event) => {
      const hasExternalFiles = !!event.dataTransfer?.types?.includes("Files");
      const sourceId = state.dragNodeId;
      if (!sourceId && !hasExternalFiles) {
        return;
      }

      const source = state.nodes.find((n) => n.id === sourceId);
      if (sourceId && (!source || source.type !== "file" || source.parentId === node.id)) {
        return;
      }

      event.preventDefault();
      row.classList.add("drag-target");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-target");
    });

    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.classList.remove("drag-target");
      const externalFiles = Array.from(event.dataTransfer?.files || []);

      if (externalFiles.length && !state.dragNodeId) {
        clearTreeDropTargets();
        await importFiles(externalFiles, node.id);
        return;
      }

      const sourceId = state.dragNodeId || event.dataTransfer?.getData("text/plain");
      state.dragNodeId = null;
      clearTreeDropTargets();

      if (!sourceId) {
        return;
      }

      await moveFileToFolder(sourceId, node.id);
    });
  }

  row.addEventListener("click", () => {
    hideContextMenu();
    flushPendingEditorSave();
    state.selectedId = node.id;
    if (node.type === "folder" && hasChildren) {
      if (state.expanded.has(node.id)) {
        state.expanded.delete(node.id);
      } else {
        state.expanded.add(node.id);
      }
    }
    render();
  });

  row.addEventListener("contextmenu", (event) => {
    if (node.id === ROOT_ID) {
      return;
    }

    event.preventDefault();
    state.selectedId = node.id;
    render();
    showContextMenu(event, node);
  });

  li.appendChild(row);
  return li;
}

function clearTreeDropTargets() {
  const targets = ui.tree.querySelectorAll(".tree-row.drag-target");
  for (const element of targets) {
    element.classList.remove("drag-target");
  }
}

function setPreviewButtonContent(mode, options = {}) {
  if (mode === "preview") {
    ui.previewBtn.innerHTML = "Edit";
    ui.previewBtn.title = "Back to edit (E)";
    return;
  }

  ui.previewBtn.innerHTML = EYE_ICON;
  ui.previewBtn.title = options.html ? "Preview in new tab (Ctrl+P)" : "Preview (Ctrl+P)";
}

function renderEditor() {
  const selected = getSelectedNode();
  if (!selected) {
    ui.editorTitle.textContent = "No file selected";
    ui.editorMeta.textContent = "Select a text file to edit its content.";
    ui.editor.value = "";
    ui.editor.disabled = true;
    ui.editor.hidden = false;
    ui.saveBtn.disabled = true;
    ui.previewBtn.disabled = true;
    ui.previewBtn.hidden = true;
    resetPreviewSurface();
    ui.preview.hidden = true;
    ui.downloadBtn.disabled = true;
    return;
  }

  if (selected.type === "folder") {
    ui.editorTitle.textContent = selected.name;
    ui.editorMeta.textContent = "Folder selected. Choose or create a text file to edit.";
    ui.editor.value = "";
    ui.editor.disabled = true;
    ui.editor.hidden = false;
    ui.saveBtn.disabled = true;
    ui.previewBtn.disabled = true;
    ui.previewBtn.hidden = true;
    resetPreviewSurface();
    ui.preview.hidden = true;
    ui.downloadBtn.disabled = true;
    return;
  }

  ui.editorTitle.textContent = selected.name;

  const htmlNode = isHtmlNode(selected);
  if (htmlNode) {
    ui.editorMeta.textContent = `HTML file · ${selected.mime} · ${selected.size} bytes`;
    const isTextContent = typeof selected.content === "string";
    ui.editor.value = isTextContent ? selected.content : "";
    ui.editor.disabled = !isTextContent;
    ui.editor.hidden = false;
    ui.saveBtn.disabled = !isTextContent;
    ui.downloadBtn.disabled = false;
    ui.previewBtn.disabled = false;
    ui.previewBtn.hidden = false;
    setPreviewButtonContent("edit", { html: true });
    resetPreviewSurface();
    ui.preview.hidden = true;
    return;
  }

  if (!isTextFile(selected)) {
    const imageNode = isImageNode(selected);
    ui.editorMeta.textContent = imageNode
      ? `Image file · ${selected.mime} · ${selected.size} bytes`
      : `Binary/non-text file · ${selected.mime} · ${selected.size} bytes`;
    ui.editor.value = "";
    ui.editor.disabled = true;
    ui.editor.hidden = !imageNode ? false : true;
    ui.saveBtn.disabled = true;
    ui.previewBtn.disabled = true;
    ui.previewBtn.hidden = true;
    if (imageNode) {
      ui.preview.hidden = false;
      renderImagePreview(selected);
    } else {
      resetPreviewSurface();
      ui.preview.hidden = true;
    }
    ui.downloadBtn.disabled = false;
    return;
  }

  const canPreview = isMarkdownNode(selected);
  if (!canPreview && state.editorMode !== "edit") {
    state.editorMode = "edit";
  }

  ui.editorMeta.textContent = `Text file · ${selected.size} chars · ${formatDate(selected.updatedAt)}`;
  ui.editor.disabled = state.editorMode !== "edit";
  ui.saveBtn.disabled = state.editorMode !== "edit";
  ui.downloadBtn.disabled = false;
  ui.previewBtn.disabled = !canPreview;
  ui.previewBtn.hidden = !canPreview;
  if (canPreview) {
    setPreviewButtonContent(state.editorMode);
  }
  ui.editor.value = typeof selected.content === "string" ? selected.content : "";

  if (canPreview && state.editorMode === "preview") {
    ui.editor.hidden = true;
    ui.preview.hidden = false;
    renderMarkdownPreview(ui.editor.value);
  } else {
    ui.editor.hidden = false;
    ui.editor.setSelectionRange(0, 0);
    ui.editor.focus();
    if (state.editorScrollTop) {
      ui.editor.scrollTop = state.editorScrollTop;
      state.editorScrollTop = 0;
    }
    resetPreviewSurface();
    ui.preview.hidden = true;
  }
}

function onTogglePreviewMode() {
  const selected = getSelectedNode();
  if (!selected) {
    return;
  }

  if (isHtmlNode(selected)) {
    openHtmlPreviewInNewTab(selected);
    return;
  }

  if (!isMarkdownNode(selected)) {
    return;
  }

  if (state.editorMode === "edit") {
    state.editorScrollTop = ui.editor.scrollTop;
  }
  state.editorMode = state.editorMode === "edit" ? "preview" : "edit";
  syncHashWithState();
  if (state.editorMode === "preview") {
    setSidebarHidden(true);
  } else {
    setSidebarHidden(false);
  }
  renderEditor();
}

function onToggleSidebar() {
  setSidebarHidden(!state.sidebarHidden);
}

function setSidebarHidden(hidden) {
  state.sidebarHidden = hidden;
  if (!ui.treePanel) {
    return;
  }
  const workspace = ui.treePanel.parentElement;
  if (!workspace) {
    return;
  }
  if (hidden) {
    workspace.classList.add("sidebar-hidden");
    if (ui.toggleSidebarBtn) {
      ui.toggleSidebarBtn.textContent = "▶";
      ui.toggleSidebarBtn.title = "Show sidebar";
    }
  } else {
    workspace.classList.remove("sidebar-hidden");
    if (ui.toggleSidebarBtn) {
      ui.toggleSidebarBtn.textContent = "◀";
      ui.toggleSidebarBtn.title = "Hide sidebar";
    }
  }
}

function isMarkdownNode(node) {
  if (!node || node.type !== "file") {
    return false;
  }
  return /\.md(?:own)?$/i.test(node.name || "") || node.mime === "text/markdown";
}

function isImageNode(node) {
  if (!node || node.type !== "file") {
    return false;
  }
  if (typeof node.mime === "string" && node.mime.startsWith("image/")) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(node.name || "");
}

function isHtmlNode(node) {
  if (!node || node.type !== "file") {
    return false;
  }
  return /\.html?$/i.test(node.name || "") || node.mime === "text/html";
}

function isTextFile(node) {
  if (!node || node.type !== "file") {
    return false;
  }
  if (node.mime && (node.mime.startsWith("text/") || node.mime === "application/json" || node.mime === "application/javascript")) {
    return true;
  }
  return /\.(txt|md|json|js|ts|css|html?)$/i.test(node.name || "");
}

function openHtmlPreviewInNewTab(node) {
  const html = typeof node.content === "string" ? node.content : "";
  if (!html) {
    return;
  }

  const resourceUrls = [];
  const processed = resolveHtmlResources(html, node.parentId, resourceUrls);

  const win = window.open("", "_blank");
  if (!win) {
    return;
  }
  win.document.write(processed);
  win.document.close();

  setTimeout(() => {
    for (const u of resourceUrls) {
      URL.revokeObjectURL(u);
    }
  }, 60000);
}

function resolveHtmlResources(html, baseFolderId, resourceUrls) {
  const MIME_MAP = {
    js: "text/javascript",
    mjs: "text/javascript",
    css: "text/css",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    svg: "image/svg+xml",
    wasm: "application/wasm",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
  };

  function mimeForNode(node) {
    if (node.mime && node.mime !== "text/plain" && node.mime !== "application/octet-stream") {
      return node.mime;
    }
    const ext = (node.name || "").split(".").pop().toLowerCase();
    return MIME_MAP[ext] || node.mime || "application/octet-stream";
  }

  function resolveResource(src) {
    const trimmed = String(src || "").trim();
    if (!trimmed) return null;
    if (/^(https?:|data:|blob:|#|\/)/i.test(trimmed)) return null;

    const resolved = resolveNodePath(baseFolderId, trimmed);
    if (!resolved) return null;

    let blob = null;
    if (resolved.content instanceof Blob) {
      blob = resolved.content;
    } else if (typeof resolved.content === "string") {
      blob = new Blob([resolved.content], { type: mimeForNode(resolved) });
    }
    if (!blob) return null;

    const objectUrl = URL.createObjectURL(blob);
    resourceUrls.push(objectUrl);
    return objectUrl;
  }

  // Replace src="..." and src='...' on resource tags
  html = html.replace(
    /(<(?:img|script|source|iframe|video|audio)\s[^>]*?)(src\s*=\s*["'])([^"']+)(["'])/gi,
    (match, before, attr, url, quote) => {
      const blobUrl = resolveResource(url);
      return blobUrl ? before + attr + blobUrl + quote : match;
    }
  );

  // Replace href="..." and href='...' on link tags
  html = html.replace(
    /(<link\s[^>]*?)(href\s*=\s*["'])([^"']+)(["'])/gi,
    (match, before, attr, url, quote) => {
      const blobUrl = resolveResource(url);
      return blobUrl ? before + attr + blobUrl + quote : match;
    }
  );

  return html;
}

function releasePreviewObjectUrl() {
  if (!state.previewObjectUrl) {
    return;
  }
  URL.revokeObjectURL(state.previewObjectUrl);
  state.previewObjectUrl = null;
}

function releasePreviewImageObjectUrls() {
  for (const url of state.previewImageObjectUrls) {
    URL.revokeObjectURL(url);
  }
  state.previewImageObjectUrls = [];
}

function resetPreviewSurface() {
  if (!ui.preview) {
    return;
  }
  releasePreviewObjectUrl();
  releasePreviewImageObjectUrls();
  ui.preview.classList.remove("preview-image");
  ui.preview.innerHTML = "";
}

function renderMarkdownPreview(markdown) {
  if (!ui.preview) {
    return;
  }

  releasePreviewObjectUrl();
  releasePreviewImageObjectUrls();
  ui.preview.classList.remove("preview-image");
  const text = typeof markdown === "string" ? markdown : "";
  if (!window.MarkdownLite || typeof window.MarkdownLite.render !== "function") {
    ui.preview.innerHTML = `<p>${escapeHtml("Markdown preview library unavailable.")}</p>`;
    return;
  }

  const selected = getSelectedNode();
  const imageResolver = buildMarkdownImageResolver(selected);
  ui.preview.innerHTML = window.MarkdownLite.render(text, { imageResolver });
}

function buildMarkdownImageResolver(markdownNode) {
  if (!markdownNode) {
    return null;
  }

  return function resolveImagePath(src) {
    const trimmed = String(src || "").trim();
    if (!trimmed) {
      return null;
    }

    // Resolve the path relative to the markdown file's parent folder.
    const resolved = resolveNodePath(markdownNode.parentId, trimmed);
    if (!resolved) {
      return null;
    }

    const node = resolved;
    let blob = null;
    if (node.content instanceof Blob) {
      blob = node.content;
    } else if (typeof node.content === "string") {
      blob = new Blob([node.content], { type: node.mime || "application/octet-stream" });
    }

    if (!blob) {
      return null;
    }

    const objectUrl = URL.createObjectURL(blob);
    state.previewImageObjectUrls.push(objectUrl);
    return objectUrl;
  };
}

function resolveNodePath(baseFolderId, relativePath) {
  // Strip leading ./
  const clean = relativePath.replace(/^\.\//, "");
  const segments = clean.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }

  let currentFolderId = baseFolderId || ROOT_ID;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    const folder = state.nodes.find(
      (n) => n.parentId === currentFolderId && n.type === "folder" && n.name === seg
    );
    if (!folder) {
      return null;
    }
    currentFolderId = folder.id;
  }

  const filename = segments[segments.length - 1];
  return state.nodes.find(
    (n) => n.parentId === currentFolderId && n.type === "file" && n.name === filename
  ) || null;
}

function renderImagePreview(node) {
  if (!ui.preview) {
    return;
  }

  releasePreviewObjectUrl();
  ui.preview.classList.add("preview-image");
  ui.preview.innerHTML = "";

  let blob = null;
  if (node.content instanceof Blob) {
    blob = node.content;
  } else if (typeof node.content === "string") {
    blob = new Blob([node.content], { type: node.mime || "image/*" });
  }

  if (!blob) {
    ui.preview.textContent = "Image preview unavailable for this file.";
    return;
  }

  const img = document.createElement("img");
  img.className = "preview-image-element";
  img.alt = node.name || "Image preview";
  state.previewObjectUrl = URL.createObjectURL(blob);
  img.src = state.previewObjectUrl;
  ui.preview.appendChild(img);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

init().catch((error) => {
  console.error(error);
  window.alert(`Initialization failed: ${error.message}`);
});
