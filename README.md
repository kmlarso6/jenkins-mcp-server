# Jenkins MCP Server

An MCP (Model Context Protocol) server for interacting with Jenkins instances protected by Cloudflare Access. Built for use with Kiro and other MCP-compatible AI coding tools.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) CLI installed
- A Jenkins API token (generate one from Jenkins → {Your User} → Security → API Token)

## Installation

1. Clone this repo:

```bash
git clone https://github.com/kmlarso6/jenkins-mcp-server.git
cd jenkins-mcp-server
```

2. Install dependencies:

```bash
npm install
```

## MCP Configuration

Add the following to your Kiro MCP config at `~/.kiro/settings/mcp.json` (or your workspace `.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "Jenkins": {
      "command": "node",
      "args": ["/path/to/jenkins-mcp-server/index.mjs"],
      "env": {
        "JENKINS_URL": "https://jenkins.devops.asu.edu",
        "JENKINS_USER": "{YOUR_USER_ID}",
        "JENKINS_TOKEN": "{YOUR_API_KEY}"
      },
      "disabled": false,
      "autoApprove": [
        "get_build",
        "get_build_log",
        "get_job",
        "list_builds",
        "get_test_results",
        "get_artifact",
        "download_test_results",
        "list_stages",
        "get_stage_log",
        "get_failed_tests",
        "compare_builds"
      ]
    }
  }
}
```

Replace:
- `/path/to/jenkins-mcp-server/index.mjs` with the absolute path to your cloned copy
- `{YOUR_USER_ID}` with your Jenkins username (typically exception ASURITE or email address)
- `{YOUR_API_KEY}` with your Jenkins API token

### PoP (Proof of Presence) Instances

PoP instances run at different URLs (e.g. `jenkins-{product}.devops.asu.edu`) and typically require separate credentials. Add an MCP server entry for each PoP instance:

```json
{
  "mcpServers": {
    "Jenkins": {
      "command": "node",
      "args": ["/path/to/jenkins-mcp-server/index.mjs"],
      "env": {
        "JENKINS_URL": "https://jenkins.devops.asu.edu",
        "JENKINS_USER": "{YOUR_USER_ID}",
        "JENKINS_TOKEN": "{YOUR_API_KEY}"
      },
      "disabled": false,
      "autoApprove": ["get_build", "get_build_log", "get_job", "list_builds", "get_test_results", "get_artifact", "download_test_results", "list_stages", "get_stage_log", "get_failed_tests", "compare_builds"]
    },
    "Jenkins-PoP": {
      "command": "node",
      "args": ["/path/to/jenkins-mcp-server/index.mjs"],
      "env": {
        "JENKINS_URL": "{YOUR_POP_URL}",
        "JENKINS_USER": "{YOUR_POP_USER_ID}",
        "JENKINS_TOKEN": "{YOUR_POP_API_KEY}"
      },
      "disabled": false,
      "autoApprove": ["get_build", "get_build_log", "get_job", "list_builds", "get_test_results", "get_artifact", "download_test_results", "list_stages", "get_stage_log", "get_failed_tests", "compare_builds"]
    },
    ...
  }
}
```

Each instance needs its own Cloudflare Access login (see below) and its own Jenkins API token. If your credentials are shared across instances, you can instead use the `baseUrl` parameter on any tool call to override the default Jenkins URL.

> **Note:** The username format may differ between instances. For example, the main instance may use your exception ASURITE (`ex_asurite`) while a PoP instance may require your exception ASURITE email address (`ex_asurite@asu.edu`). Check your user profile on each Jenkins instance to confirm.

## Cloudflare Access Authentication

Each Jenkins instance is behind Cloudflare Access. You need a valid token for every instance you connect to.

### Initial Login

```bash
# Main instance
cloudflared access login "https://jenkins.devops.asu.edu"

# PoP instance (repeat for each PoP URL you use)
cloudflared access login "https://jenkins-{product}.devops.asu.edu"
```

This command will automatically open a tab in your default browser AND print an authorization URL to the terminal. Since Jenkins access is typically granted to your exception ASURITE, you'll likely need to authenticate in a browser session where you're logged in as your exception ID.

**Recommended flow:**
1. Close the auto-opened browser tab
2. Copy the URL printed in the terminal
3. Open it in an incognito/private window or a browser profile where you can log in with your exception ASURITE credentials
4. Complete the ASU SSO login
5. The terminal command will detect success and cache the token automatically at `~/.cloudflared/`



### Token Verification

```bash
cloudflared access token -app=https://jenkins.devops.asu.edu
cloudflared access token -app=https://jenkins-{product}.devops.asu.edu
```

If this returns a JWT string, you're authenticated.

### Token Expiry

Tokens expire after several hours. If MCP tool calls start failing with Cloudflare errors, re-run the login command for the affected instance.

## Installing the Kiro Skill

This repo includes a Kiro skill that helps the AI agent manage the Cloudflare auth flow automatically.

To install it, copy the skill into your Kiro skills directory:

```bash
cp -r skills/jenkins-access ~/.kiro/skills/
```

Once installed, Kiro will activate the skill when Jenkins access is needed or when auth errors occur.

## Instance Mapping (Steering File)

If you have multiple Jenkins instances configured, you can create a steering file to help the AI agent know which instance to query for a given repo without trial-and-error.

Copy the example into your global steering directory:

```bash
cp steering/jenkins-instances.example.md ~/.kiro/steering/jenkins-instances.md
```

Edit it to map your repos to their respective instances. When the steering file is provided as context (via `#jenkins-instances.md`), the agent will use it to pick the right instance. When a repo isn't mapped, the agent will try all configured instances in parallel.

## Available Tools

| Tool | Description |
|------|-------------|
| `get_build` | Get info about a specific build |
| `get_build_log` | Get console output for a build |
| `get_job` | Get job info and recent builds list |
| `list_builds` | List recent builds with results |
| `get_test_results` | Get test report for a build |
| `get_artifact` | Read a text artifact inline |
| `download_test_results` | Download Playwright artifacts to a local temp dir |
| `list_stages` | List pipeline stages with status and duration |
| `get_stage_log` | Get console log for a specific pipeline stage |
| `get_failed_tests` | Get only failing test cases with error messages |
| `compare_builds` | Compare test results between two builds |

## Job Path Format

Jenkins job paths follow the pattern: `<GitHub-Org>/<repo-name>/<branch>`

For example: `MyOrg/my-repo/main`

### Branches with Slashes

If a branch name contains slashes (e.g. `feat/my-feature`), encode the slashes as `%2F` in the job path:

```
MyOrg/my-repo/feat%2Fmy-feature
```

The server will correctly encode this into the Jenkins URL format. You can find the exact branch name by calling `get_job` on the repo path (without the branch) — the response lists all branches with their encoded names.

### PoP Job Path Patterns

PoP instances may use a different GitHub org prefix than the main instance. Use `get_job` on the org folder to discover available repos, then on the repo to discover branches.
