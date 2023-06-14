# pre

Enter and exit pre mode in a Changesets repo.

## Usage

```ts
await enterPre(cwd, tag);

let preState = await readPreState(cwd);

// version packages with @changesets/cli or get a release plan and apply it
await exitPre(cwd);
```

This package is used to enter and exit pre mode along with reading the pre state for the `publish` and `version` commands, you should only need it if you want to enter or exit pre mode programmatically.

## Types

```ts
export function enterPre(cwd: string, tag: string): Promise<void>;
export function exitPre(cwd: string): Promise<void>;
export function readPreState(cwd: string): Promise<PreState>;
```
