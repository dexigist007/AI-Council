#!/usr/bin/env bash
# Builds a signed Mac App Store package (.pkg) on a Mac. Run from the repository root.
#
# Required environment:
#   APPLE_TEAM_ID         10-character Team ID
#   MAS_APP_IDENTITY      e.g. "Apple Distribution: Your Name (TEAMID)"
#   MAS_INSTALLER_IDENTITY e.g. "3rd Party Mac Developer Installer: Your Name (TEAMID)"
#   MAS_PROFILE           path to the Mac App Store provisioning profile (.provisionprofile)
#   BUILD_NUMBER          integer, must increase with every upload (CFBundleVersion)
# Optional (upload with an App Store Connect API key):
#   ASC_KEY_ID, ASC_ISSUER_ID  (the .p8 key must be in ~/.appstoreconnect/private_keys/)
set -euo pipefail

for v in APPLE_TEAM_ID MAS_APP_IDENTITY MAS_INSTALLER_IDENTITY MAS_PROFILE BUILD_NUMBER; do
  [[ -n "${!v:-}" ]] || { echo "missing $v" >&2; exit 1; }
done
[[ -f "$MAS_PROFILE" ]] || { echo "profile not found: $MAS_PROFILE" >&2; exit 1; }
if grep -q "SUPPORT_EMAIL = ''" src/config/app.ts; then
  echo "Set SUPPORT_EMAIL in src/config/app.ts first (shown in the privacy policy, required by review)." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sed "s/__TEAM_ID__/$APPLE_TEAM_ID/g" src-tauri/Entitlements.appstore.plist > "$work/Entitlements.plist"
cp "$MAS_PROFILE" "$work/embedded.provisionprofile"
cat > "$work/tauri.appstore.conf.json" <<JSON
{
  "bundle": {
    "macOS": {
      "entitlements": "$work/Entitlements.plist",
      "files": { "embedded.provisionprofile": "$work/embedded.provisionprofile" },
      "signingIdentity": "$MAS_APP_IDENTITY",
      "bundleVersion": "$BUILD_NUMBER"
    }
  }
}
JSON

rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
npm ci
npm test
npx tauri build --target universal-apple-darwin --bundles app --config "$work/tauri.appstore.conf.json"

app="src-tauri/target/universal-apple-darwin/release/bundle/macos/Conclave.app"
codesign -d --entitlements - "$app" | grep -q app-sandbox || { echo "app is not sandboxed" >&2; exit 1; }
xcrun productbuild --sign "$MAS_INSTALLER_IDENTITY" --component "$app" /Applications "Conclave.pkg"
echo "Built: $(pwd)/Conclave.pkg"

if [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]]; then
  xcrun altool --upload-app --type macos --file "Conclave.pkg" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
else
  echo "Upload with the Transporter app, or set ASC_KEY_ID and ASC_ISSUER_ID to upload with altool."
fi
