---
inclusion: manual
---

# Jenkins Instance Mapping

Use this to determine which Jenkins MCP server to call for a given repo.
If a repo is not listed here, try both instances (call `get_job` on each in parallel).

## Main Instance (`mcp_Jenkins_*`)

URL: `https://jenkins.devops.asu.edu`
Org prefix in job paths: `{Product}/`

Known repos:
- (add your repos here)

### Legacy Pipelines (Main Instance)

Some repos use a legacy shared pipeline with non-standard job paths (warapps-deployment) that don't follow the `Org/repo/branch` pattern. These are typically manually triggered and not multibranch.

| GitHub Repo | Jenkins Job Path |
|-------------|-----------------|
| {repo-name} | `warapps-deployment/{job-name}` |

## PoP Instances

### My PoP (`mcp_Jenkins_{Product}_*`)

URL: `https://jenkins-{product}.devops.asu.edu`
Org prefix in job paths: `ASU Github-{Product}/`

Known repos:
- (add your repos here)

## Fallback Strategy

When you don't know which instance a repo lives on:
1. Check this file for a mapping
2. If not listed, call `get_job` on both instances in parallel using the appropriate org prefix for each
3. Use whichever returns a result
4. Update this file with the new mapping for future reference
