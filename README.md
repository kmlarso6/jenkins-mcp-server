# Jenkins MCP Server

An MCP (Model Context Protocol) server for interacting with Jenkins instances protected by Cloudflare Access. Built for use with Kiro and other MCP-compatible AI coding tools.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) CLI installed
- A Jenkins API token (generate one from Jenkins → Your User → Configure → API Token)

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
        "JENKINS_USER": "{YOUR_EXCEPTION_ASURITE}",
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
- `{YOUR_EXCEPTION_ASURITE}` with your Jenkins username (exception ASURITE)
- `{YOUR_API_KEY}` with your Jenkins API token

## Cloudflare Access Authentication

The Jenkins instance is behind Cloudflare Access. Before using the MCP tools, you need a valid Cloudflare token.

### Initial Login

```bash
cloudflared access login "https://jenkins.devops.asu.edu"
```

This prints an authorization URL. Open it in your browser, complete ASU SSO login, and the token is cached automatically at `~/.cloudflared/`.

### Token Verification

```bash
cloudflared access token -app=https://jenkins.devops.asu.edu
```

If this returns a JWT string, you're authenticated.

### Token Expiry

Tokens expire after several hours. If MCP tool calls start failing with Cloudflare errors, re-run the login command above.

## Installing the Kiro Skill

This repo includes a Kiro skill that helps the AI agent manage the Cloudflare auth flow automatically.

To install it, copy the skill into your Kiro skills directory:

```bash
cp -r skills/jenkins-access ~/.kiro/skills/
```

Once installed, Kiro will activate the skill when Jenkins access is needed or when auth errors occur.

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
