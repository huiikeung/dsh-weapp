# Mini-program quota dashboard protocol

`cost-meter-v1` is implemented by the WeChat gateway itself. It does not require or query a `dsh-cost-meter` plugin service.

## Requests

```json
{ "type": "cost-meter", "requestId": "req-1", "action": "config" }
```

| Action | Optional fields | Behavior |
| --- | --- | --- |
| `summary` | - | Project session token usage and return the cached quota dashboard. Sidebar-visible sources are refreshed when stale. |
| `config` | - | Read display and quota settings plus the cached dashboard; no network queries are performed for quota sources. |
| `refresh` | - | Force-refresh every enabled quota source and return the full dashboard. |
| `update` | `patch` | Validate and persist display/sidebar/budget/peak/Go/Coding Plan/custom balance/gateway source settings. |
| `refresh-source` | `source` | Refresh one source (`plan:<id>`, `gateway:<id>`, `custom:<index>`). |
| `source-config` | - | Secret-free snapshot of every configurable source and whether a credential is configured. |
| `set-source-key` / `clear-source-key` | `source`, `value`, optional `secret` | Write/clear a provider credential in the DSH credential store. Never returns the value. |
| `set-go-key` / `clear-go-key` | `value` | OpenCode Go credential (legacy aliases). |
| `set-balance-key` / `clear-balance-key` | `value` | DeepSeek balance API key fallback. |

`patch` supports: `currency`, `symbol`, `decimals`, `exchangeRate`, `display` (`sidebarStyle`: `summary` / `simple` / `standard` / `compact`, `sidebarVisible`, `peakStyle`), `balance`, `goQuota`, `budget` (display only; amount/period go to the cost-meter summary layer), `peak`, `codingPlans` (`enabled`, `display`, `refreshMinutes` plus per-vendor fields), `customBalances` (up to 8 entries) and `gatewayQuotas.sources` (up to 4 CLIProxyAPI sources).

## Quota sources

- **Official account balance** uses Host `accountController.getBalance()`; when not signed in, `DSH_WEAPP_DEEPSEEK_BALANCE_API_KEY` / `DEEPSEEK_API_KEY` can read the DeepSeek Platform balance.
- **OpenCode Go** reads `https://opencode.ai/zen/go/v1/usage`; keys resolve from DSH credentials, environment variables or OpenCode's local auth file.
- **Coding Plan vendors** (OpenDesign, Factory, Anthropic, Z.ai, MiniMax, Kimi, OpenRouter, SiliconFlow, CommandCode, Cline Pass, SCNet, Volcano Ark, Qwen, MiMo, WorkBuddy) are queried by the gateway with the same vendor adapters as the reference plugin (vendored under the gateway's `lib/vendor/cost-meter/`, MIT). SCNet and Qwen estimate credits from local per-model session usage and require a monthly Credits quota; the others use provider credentials, OAuth tokens or console cookies.
- **CLIProxyAPI gateway sources** aggregate account quotas from local/LAN proxy gateways. Only exact `allowedHosts` entries are accepted; non-loopback HTTP additionally requires `allowInsecureHttp`.
- **Custom Provider balances** call a user-supplied HTTP endpoint with declarative JSON-path extraction (`remaining`, optional `maxBudget`/`spend`), at most 8 entries. Header values support `{{VAR}}` placeholders resolved from the DSH credential store or the environment. Secrets are stored only in the Host credential store; response payloads expose `configured` booleans.

## Storage and security

- Display/quota settings live in `$DSH_HOME/storages/weapp-cost-dashboard.json` (override with `DSH_WEAPP_COST_DASHBOARD_FILE`) with mode `0600`.
- Credential values never appear in responses, persisted settings or logs.
- Fixed vendor endpoints are used for Coding Plans; custom balance endpoints require `https` (loopback may use `http`), refuse redirects and honour the explicit host allowlist before sending credentials.
- Session token usage stays a separate projection over host session history; per-day/per-model buckets only back the local SCNet/Qwen estimates.
