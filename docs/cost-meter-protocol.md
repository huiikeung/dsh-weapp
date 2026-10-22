# Mini-program quota dashboard protocol

`cost-meter-v1` is implemented by the WeChat gateway itself. It does not require or query a `dsh-cost-meter` plugin service.

## Requests

```json
{ "type": "cost-meter", "requestId": "req-1", "action": "config" }
```

| Action | Optional fields | Behavior |
| --- | --- | --- |
| `summary` | - | Project recorded session token usage and read the quota dashboard. |
| `refresh` | - | Bypass balance/quota caches and refresh available data. |
| `config` | - | Read display and quota settings without folding session history. |
| `update` | `patch` | Validate and persist allowlisted display/peak/Go settings on the host. |
| `set-go-key` | `value` | Save an OpenCode Go key through the DSH credential service; never persist it in dashboard JSON or return it to the client. |
| `clear-go-key` | - | Remove the dedicated `OPENCODE_GO_API_KEY` credential. |

## Data sources and storage

- Official account balance uses the Host `accountController.getBalance()` API when available.
- OpenCode Go usage comes from the fixed HTTPS endpoint `https://opencode.ai/zen/go/v1/usage`; keys resolve from DSH credentials, environment variables, or OpenCode's local auth file.
- Peak/off-peak windows and Go display choices are stored in `$DSH_HOME/storages/weapp-cost-dashboard.json` (or `~/.dsh/...` when unset) with restrictive file permissions. API keys stay in the Host credential store.
- Session-token usage remains a separate projection over host session history. The compact sidebar does not render fee summaries in the conversation header or composer.

## Security

Requests are accepted only over a paired control connection. Credential values are never included in responses, dashboard settings, or logs. The quota endpoint is fixed to the official OpenCode HTTPS origin; no user-supplied URL is fetched.
