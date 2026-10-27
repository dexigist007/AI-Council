# Notes for App Review (paste into App Store Connect → App Review Information → Notes)

Conclave is a free, local-first app. The user brings their own API key for an AI provider
(bring-your-own-key); the app has no server, no account and no analytics. Data goes directly from
the Mac to the provider the user chooses, after the user gives explicit permission per provider.

To test without setting anything up, please use this test key (spending-capped, revoked after review):

  Provider: <Groq / OpenRouter / Gemini>
  API key:  <PASTE TEST KEY HERE>

Steps:
1. Open Settings. In the "<Provider>" card paste the key and click Save, switch on "Enabled",
   click the refresh button next to "Default model" and choose <model id>.
2. Click "Test connection". A permission dialog explains where data goes; click Allow.
3. Open "Discovery", type a goal (for example "a small side business I can start with $200"),
   and click "Start discovery". The live debate between the AI members appears, followed by a report.
   For a council you need at least two members; the same provider can be used twice with different roles.
4. "Ideas" → create an idea → "Start council" evaluates a single idea.
5. Settings → Privacy & data shows the permissions, the privacy policy and "Delete all data".

Notes:
- Output is private to the user and never posted or shared; there is no user-generated content feed.
- Discovery shows a disclaimer that results are AI-generated and are not financial, legal or tax advice.
- Projects (optional) read a folder the user picks with the system folder dialog, read-only, to answer
  questions about the code; access is kept with security-scoped bookmarks.
