# Changesets Release Action

This action for [Changesets](https://github.com/changesets/changesets) runs the Snapshot workflow for your repository, based on changes done in Pull Requests.

This action is helpful if you wish to create an automated release flow in trunk branch, release branches, and PRs.

The following flow is being executed:

- Check for available `changeset` files in the PR.
- Runs `version` flow in `snapshot` mode (`--snapshot` flag, `x.y.z-{commit-hash}-develop` schema) and stable mode (`x.y.z` schema).
- Calculate changes which packages were changed and should be released.
- Runs user script for build/preparation for the release.
- Create commit (and annotated tags) with changed versions, removed changesets and updated changelogs. By default, works only in `stable` mode, could be overridden manually.
- Publishes a GitHub release with the list of releases done. By default, works only in `stable` mode, could be overridden manually.
- Publishes a GitHub comment on the Pull Request, with the list of releases done.

<img width="1060" src="./docs/example.png">

## Usage

### Inputs
- `mode`: - "snapshot | stable. Default is snapshot. Snapshot releases are meant to be used for canary releases (could be used in trunk branch and feature branches), and stable releases are meant to be used for stable releases.
required: true
- `prepare-script` - A custom, user-provided script, that is being executed after `version` script. Usually, this is where your `build` script goes.
- `cwd` - Changes node's `process.cwd()` if the project is not located on the root. Default to `process.cwd()`
- `setup-git-user` - Sets up the git user for commits as `"github-actions[bot]"`. Default to `true`
- `commit` - Release commit. Works only in `stable` mode. Default to `true` in `stable` mode.  
- `tag` - Release tag. Works only in `stable` mode. Default to `true` in `stable` mode.
- `github-release` - A boolean value to indicate whether to create Github releases. Default to `true` in `stable` mode.
- `comment` - By default, this action will add comment in PR with information about packages and theirs versions to be released.
- `release-codenames` - An array of dictionaries that containing the words to use for generating the release codename (e.g. adjectives, animals, colors, countries, languages, names, starWars).
- `snapshot-tag` - A custom tag for snapshot releases. Default to current branch name.

### Outputs

- `upgraded` - A boolean value to indicate whether a publishing is happened or not
- `upgraded-packages` - A JSON array to present the upgraded packages. The format is `[{"name": "@xx/xx", "version": "1.2.0" "path": "apps/web", "config": { ...config field from package.json }}, {"name": "@xx/xy", "version": "0.8.9", "path": "apps/api", "config": { ... config field from package.json }}]`

### Example workflow:

#### Without Publishing

Create a file at `.github/workflows/ci.yml` with the following content.

```yml
name: CI

on:
  push:
    branches: ["main"]
  pull_request:
    types: [opened, synchronize]
env:
  NPM_AUTH_TOKEN: ${{ secrets.GH_PAT }}
jobs:
  build:
    name: Build and Test
    outputs:
      upgraded: ${{ steps.release.outputs.upgraded }}
      upgraded-packages: ${{ steps.release.outputs.upgradedPackages }}
    timeout-minutes: 15
    runs-on: ubuntu-latest
    steps:
      - name: Check out code
        uses: actions/checkout@v3
        with:
          fetch-depth: 2
      - name: Setup Node.js environment
        uses: actions/setup-node@v3
        with:
          node-version: 16
          cache: "pnpm"
          
      # this is where you do your regular setup, dependencies installation and so on
      
      - name: Release
        uses: "edenlabllc/changesets-action@v1"
        with:
          mode: ${{ startsWith(github.ref_name, 'release/') != true && 'snapshot' || 'stable' }}
          release-codenames: |
            colors
            animals
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} # GitHub Token
```
