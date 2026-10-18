# Sync stop prices without IBKR Desktop

The existing Sync action can read stock STP and STP LMT orders from the Client Portal Web API through the local stop bridge. It only reads broker data; it does not submit, modify, or cancel orders. Initial SL preservation and cached historical recovery use the existing matching rules.

Add to `.env.local`:

```
IBKR_WEB_API_URL=https://localhost:5050/v1/api
IBKR_WEB_API_ACCOUNT_ID=YOUR_ACCOUNT_ID
IBKR_WEB_API_ALLOW_SELF_SIGNED=true
```

Run `npm run ibkr:gateway` and log in at https://localhost:5050. The local installation uses port 5050 because macOS may occupy port 5000. Then run `npm run ibkr:gateway:configure` to bind a single IBKR account to a single website user. For multiple accounts or users, configure the mapping explicitly; never guess it. Restart the stop bridge with `npm run ibkr:stop-bridge`, then use Sync normally. IBKR Desktop and TWS may remain closed. If the bridge is already installed as a launch agent, restart that service to load the new code and environment.

A Gateway session still needs to be authenticated. Flex credentials are separate and cannot authenticate live-order endpoints. Fully remote access without Gateway requires IBKR OAuth enrollment and request signing; this adapter does not implement OAuth. Do not configure the remote IBKR URL without that authentication layer.

Account ID is required so orders from another account cannot update this account's trades. Configure one bridge per account. Trailing orders are excluded because an offset is not an absolute stop price. Stop-limit orders without an explicit trigger fail visibly rather than substituting their limit price. Each sync refreshes the IBKR order cache, waits five seconds, and then reads the actual snapshot. An incomplete orders snapshot requires retry. On a source failure, existing cached history may recover Initial SL; it does not supply a fresh Current SL, and Sync reports a warning.

Self-signed TLS is supported only for loopback addresses and only when explicitly enabled.

Official references:
- https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/#monitoring-live-orders
- https://www.interactivebrokers.com/docs/web-api/authentication/sessions

## Automatic sync

`IBKR_STOP_AUTO_SYNC_SECONDS=3600` enables an hourly poll with `IBKR_STOP_SYNC_USER_ID` set to the matching website user UUID. Automatic polling starts when the bridge starts. Without that user setting, the bridge begins polling after the first successful manual Sync in its current process. Polling only runs in Web API mode; it does not launch or scan Desktop. Manual and automatic syncs are serialized. Keep both Gateway and the stop bridge running while the computer is awake.

Order data is read with GET requests. Every non-GET broker request is rejected, including authentication, order submission, modification, cancellation, and session takeover requests. The heartbeat maintains an already authenticated session; it cannot bypass expiration or the next required manual login. Disconnected sessions require manual login; the program never requests authentication. Failure logs are suppressed while their message is unchanged.

Every successful sync saves stop history for 180 days using the existing bridge cache. This history begins when observed; it cannot reconstruct stops moved or cancelled before capture. Open orders from previous days remain visible while active. Filled/cancelled orders are limited to the current IBKR brokerage session. Flex continues to provide historical executions separately.

The bridge sends a read-only session heartbeat every 60 seconds, separately from the hourly order sync. This prevents inactivity timeout while Gateway and the bridge are running, but cannot restore an expired login or prevent IBKR session resets.

## Login policy, background service, and disconnect alerts

Automatic authentication and session recovery are disabled. The broker transport rejects every non-GET request, including session initialization. The one-minute heartbeat only preserves an existing authenticated session; it cannot trigger phone authorization, take over another trading session, or perform broker order writes. Orders still sync hourly.

`npm run ibkr:gateway:install` installs the Gateway as a macOS user LaunchAgent. It starts at user login and restarts the Gateway process after a crash; this never performs IBKR login. Manual authentication is required after expiry. Computer sleep still pauses heartbeats.

`npm run ibkr:gateway:notifications` builds the local **Trading Analyzer Gateway Alerts** app. Enable its notifications in macOS before relying on alerts. The bridge sends one native notice per detected outage and persists that state across bridge restarts. Successful authentication rearms the next outage alert. Notices tell you to log in manually at https://localhost:5050 and explicitly state that no login/phone authorization request was initiated. No password or authentication code is stored.

Permission or delivery failures are reported under `notifications.error` in `/health`. macOS Focus modes and notification settings may suppress presentation; an OS delivery request is not proof the user saw the alert. These background checks and notices use local code, not AI tokens.

Tests: `npm run test:gateway-session-regression` verifies no automatic authentication requests and deduplicated alerts; `npm run test:web-stop-orders-regression` checks order parsing.
