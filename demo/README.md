# Demo mode

The real UI in a browser with example data, for screenshots and quick UI work. It never touches
the keychain, the network or your files: the database client and the Tauri bridge are swapped for
`demo/client.ts` (SQLite through the dev server) and `demo/platform.ts` (stubs).

```sh
npm run demo:seed -- /tmp/demo-en.db en     # or: tr
DEMO_DB=/tmp/demo-en.db npm run demo        # http://localhost:1430
```

Everything in `demo/seed.ts` is illustrative example content.
