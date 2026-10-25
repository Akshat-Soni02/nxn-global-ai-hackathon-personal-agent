# Shadow: the whole picture

> Redrawn 25 Oct 2026 for **Shadow, managed**: no API key on the Mac, model calls and connected-app calls go through Shadow's own service on Google Cloud. The full design of that service is [`docs/cloud-architecture.md`](../cloud-architecture.md); the rest of Shadow is [`docs/design.md`](../design.md).
> The 12 Oct version (the local pieces only, how one approval travels, the locks on each door) is kept in [`history/13-the-whole-picture-oct12.md`](history/13-the-whole-picture-oct12.md); what it says about the Mac still holds.

![Shadow, managed: what runs where](13-the-whole-picture.png)

Edit it: [`13-the-whole-picture.svg`](13-the-whole-picture.svg) is plain SVG; change it in any editor and render it again to the PNG (any browser can print it, or headless Chrome).

## How to read it

1. **Your Mac (left), unchanged in what it does.** Shadow.app, the daemon, the Chrome extension and the native host work as before: recording, masking, the design and repair agents, runs, the inbox and memory all stay here. Two things are new in the daemon: an **account** (a device token in the Keychain, where the Nebius key used to be) and an **MCP client** that runs the new `mcp` steps.
2. **Google Cloud (middle), new.** One stateless Cloud Run service, `shadow-api`. It signs the app in, relays model calls to Nebius with Shadow's key, offers each user one MCP server with the tools of the apps they connected, and counts every call against the free tier before making it (Firestore: reserve, then settle). Keys live in Secret Manager; logs hold metadata only.
3. **Outside services (right).** Nebius Token Factory (Zero Data Retention on Shadow's organisation) and Composio, which holds each user's connected accounts and runs the tools against the apps' own APIs. Only `shadow-api` talks to them.
4. **The browser, twice.** Once to sign in, once per app you connect (Composio's sign-in page). Nothing else happens there.
5. **What leaves the Mac** (bottom right): masked screen words, narration text, workflow steps and AI-step inputs to Nebius; a tool's arguments and result to Composio. Everything else stays (bottom left).

**No caps when developing:** `NEBIUS_API_KEY` in `.env` makes the daemon call Nebius directly, without the service. See [`docs/cloud-architecture.md`](../cloud-architecture.md), "Running locally (no caps)".
