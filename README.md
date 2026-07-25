# Backend-Less Secure AF File exchanger

A privacy-first, serverless file exchange web app that lets browsers share files directly with each other using PeerJS/WebRTC. *Secure AF.*

## Core Principle

- The app server hosts only static assets (HTML/CSS/JS).
- File content never transits through that server.
- File content is never uploaded to cloud storage by the app.
- Browsers connect peer-to-peer and exchange encrypted data directly.

## How It Works

1. A browser creates or opens a session URL containing a fragment-based session token.
2. Peers join the same session and establish WebRTC connections (via PeerJS signaling).
3. Each peer keeps a local encrypted IndexedDB copy of the filesystem.
4. Local changes are committed as transactions and replicated to all connected peers.
5. Incoming transactions are applied atomically and persisted locally.

## Features

- Peer-to-peer file sharing via WebRTC (with BroadcastChannel fallback)
- Local encrypted storage (AES-128-GCM) in IndexedDB
- Real-time synchronization across peers
- Create, rename, delete, duplicate files and folders
- Drag-and-drop import from the OS
- Text editor with auto-save and Markdown preview
- Image preview
- Right-click context menu
- Theme support (light, dark, auto)
- QR code sharing for session links
- Connection diagnostics panel

## Quick Start

Open the app in a browser. A session ID is generated automatically and added to the URL fragment. Share the full URL with someone to start exchanging files.

## Tech Stack

- Vanilla JS (no framework, no build step)
- PeerJS for WebRTC peer discovery
- BroadcastChannel as same-origin fallback
- IndexedDB for local persistence
- Web Crypto API for encryption (AES-GCM, HKDF)
- QRCode.js (self-hosted) for QR generation

## Library Sources

- QR code generation is powered by QRCode.js (self-hosted in this project): https://github.com/davidshimjs/qrcodejs
- PeerJS (loaded from CDN): https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js

## Disclaimer

This project defines a strong privacy direction, but the authentication model is intentionally incomplete and must be finalized before production use. Until then, treat this as an experimental secure-by-design prototype.

---

For detailed technical documentation (data model, encryption, sync protocol, threat model), see [TECHNICAL.md](TECHNICAL.md).