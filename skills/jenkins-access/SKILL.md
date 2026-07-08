---
name: Jenkins Access
description: |
  Handles Cloudflare Access authentication for the ASU Jenkins instance.
  Manages the cloudflared login flow and provides context for using
  Jenkins MCP tools (builds, logs, test results, artifacts).
  Activate when Jenkins access is needed or auth errors occur.
inclusion: manual
keywords:
  - jenkins
  - build
  - pipeline
  - cloudflare
  - cloudflared
  - playwright results
  - test results
  - build results
---

# Jenkins Access via Cloudflare

This skill handles authenticating to the ASU Jenkins instance which is
protected by Cloudflare Access. The Jenkins MCP server requires a valid
Cloudflare Access token to make API calls.

## When to Activate

- When the Jenkins MCP server returns an error about Cloudflare Access token
- When the user asks to check Jenkins builds, logs, or test results
- When any `mcp_Jenkins_*` tool call fails with authentication errors
- When the user mentions needing to log into Jenkins
- When the user needs to access a PoP Jenkins instance (different URL)

## Authentication Flow

### Step 1: Run Cloudflare Access Login

Run the login command. Note: `cloudflared` will attempt to open a browser
AND print the URL to the terminal. We only care about the printed URL —
present it to the user so they can open it in the browser of their choice.

```bash
cloudflared access login "https://jenkins.devops.asu.edu"
```

This command will output an authorization URL. Present it to the user clearly:

> **Cloudflare Access Authorization Required**
>
> Open this URL in your browser (use incognito/private window if needed):
> `<URL from output>`
>
> Complete the ASU SSO login in the browser, then confirm here.

### Step 2: Wait for Completion

The `cloudflared access login` command will block until the user completes
browser authentication. Use `control_bash_process` with action "start" to run
it as a background process, then poll `get_process_output` to check for the
authorization URL and completion.

**Process flow:**
1. Start the login command as a background process
2. Call `get_process_output` to check for the URL
3. Present the URL to the user
4. Ask the user to confirm when they've completed browser auth
5. Call `get_process_output` to verify success
6. Once confirmed, proceed with the original Jenkins request

### Step 3: Verify Token

After successful login, verify the token works:

```bash
cloudflared access token -app=https://jenkins.devops.asu.edu
```

If this returns a JWT token string, authentication is successful.

## Token Details

- **Token location:** `~/.cloudflared/` (cached automatically)
- **Token lifetime:** Tokens expire after several hours (varies by Cloudflare policy)
- **Renewal:** When expired, re-run the login flow

## How the Jenkins MCP Server Uses the Token

The MCP server at `~/.kiro/jenkins-mcp-server/index.mjs` calls
`cloudflared access token -app=https://jenkins.devops.asu.edu` on each request
to get the CF token, then sends it as a `cf-access-token` header alongside
Jenkins basic auth credentials.

If the token is expired, the MCP server will throw an error like:
> "Failed to get Cloudflare Access token. Run cloudflared access login..."

## Jenkins Job Paths

Job paths follow the pattern `<GitHub-Org>/<repo-name>/<branch>`. Discover
available jobs using the `get_job` tool with a folder path, or ask the user
for their specific job path.

## Finding Which Instance Has a Repo

When the user asks about a Jenkins build without specifying the instance:
1. Check the `jenkins-instances.md` steering file (activate with `#jenkins-instances.md` context) for a known mapping
2. If the repo isn't mapped, try all configured Jenkins MCP servers in parallel by calling `get_job` on each with the appropriate org prefix
3. Use whichever returns a result (the others will 404)
4. Mention to the user which instance the repo was found on

## Available MCP Tools

Once authenticated, these Jenkins MCP tools are available:

| Tool | Description |
|------|-------------|
| `get_build` | Get info about a specific build |
| `get_build_log` | Get console output (supports pagination via startLine) |
| `get_job` | Get job info + recent builds list |
| `list_builds` | List recent builds with results |
| `get_test_results` | Get full test report for a build |
| `get_failed_tests` | Get only failing/erroring test cases with error messages (much more concise than get_test_results) |
| `compare_builds` | Compare test results between two builds to see which tests flipped (pass↔fail) |
| `get_artifact` | Read a text artifact inline (e.g. junit.xml, error-context.md, .last-run.json) |
| `download_test_results` | Download playwright test-results/report artifacts to local temp dir |
| `list_stages` | List pipeline stages for a build with status and duration |
| `get_stage_log` | Get console log for a specific pipeline stage (by name or ID) |

## Important Notes

- **Present the URL from terminal output** — `cloudflared` may auto-open a browser,
  but always present the URL from the terminal output so the user can open it
  in the browser of their choice (the auto-opened window can be ignored/closed).
  Jenkins access is typically granted to exception ASURITEs, so users will likely
  need to authenticate in an incognito window or a browser profile where they can
  log in with their exception credentials.
- **Session expiry** — If a Jenkins MCP call fails, try re-authenticating first.
- **The MCP server handles token injection** — you don't need to manually pass
  tokens to Jenkins API calls. Just use the `mcp_Jenkins_*` tools directly.
- **PoP instances** — PoP (Proof of Presence) Jenkins instances run at different
  URLs (e.g. `jenkins-{product}.devops.asu.edu`). Each requires its own Cloudflare
  login and is typically configured as a separate MCP server entry with its own
  credentials. Run `cloudflared access login` for each PoP URL separately.
- **Branches with slashes** — If a branch name contains slashes (e.g.
  `feat/my-feature`), encode the slashes as `%2F` in the jobPath parameter:
  `"MyOrg/my-repo/feat%2Fmy-feature"`
