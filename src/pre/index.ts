import * as fs from "fs-extra";
import path from "path";
import { getPackages } from "@manypkg/get-packages";
import { PreExitButNotInPreModeError } from "@changesets/errors";
import { PreState, Mode } from "../types";

export async function readPreState(cwd: string): Promise<PreState | undefined> {
  let preStatePath = path.resolve(cwd, ".changeset", "prerelease.json");
  // TODO: verify that the pre state isn't broken
  let preState: PreState | undefined;
  try {
    let contents = await fs.readFile(preStatePath, "utf8");
    try {
      preState = JSON.parse(contents);
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error("error parsing json:", contents);
      }
      throw err;
    }
  } catch (err) {
    if ((err as any).code !== "ENOENT") {
      throw err;
    }
  }
  return preState;
}

export async function exitPre(cwd: string = process.cwd()) {
  let preStatePath = path.resolve(cwd, ".changeset", "prerelease.json");
  // TODO: verify that the pre state isn't broken
  let preState = await readPreState(cwd);

  if (preState === undefined) {
    throw new PreExitButNotInPreModeError();
  }

  let packages = await getPackages(cwd);
  let newPreState: PreState = {
    mode: "stable",
    initialVersions: {},
    changesets: [],
  };
  for (let pkg of packages.packages) {
    newPreState.initialVersions[pkg.packageJson.name] = pkg.packageJson.version;
  }

  await fs.outputFile(
    preStatePath,
    JSON.stringify(newPreState, null, 2) + "\n"
  );
}

export async function enterPre(mode: Mode, cwd: string, changesets: string[]) {
  const packages = await getPackages(cwd);
  const preStatePath = path.resolve(
    packages.root.dir,
    ".changeset",
    "prerelease.json"
  );
  const preState: PreState | undefined = await readPreState(packages.root.dir);
  // can't reenter if pre mode still exists, but we should allow exited pre mode to be reentered
  if (preState?.mode === "snapshot") {
    console.log(
      "prerelease mode cannot be entered when in already prerelease mode. skipping..."
    );
  }
  let newPreState: PreState = {
    mode,
    initialVersions: {},
    changesets: [...new Set([...(preState?.changesets ?? []), ...changesets])],
  };
  for (let pkg of packages.packages) {
    newPreState.initialVersions[pkg.packageJson.name] = pkg.packageJson.version;
  }
  await fs.outputFile(
    preStatePath,
    JSON.stringify(newPreState, null, 2) + "\n"
  );
}

export async function updatePreState(changesets: string[], cwd: string) {
  let packages = await getPackages(cwd);
  let preStatePath = path.resolve(
    packages.root.dir,
    ".changeset",
    "prerelease.json"
  );
  let preState: PreState | undefined = await readPreState(packages.root.dir);
  if (preState === undefined) {
    throw new Error(
      "pre state should exist when updating pre state. this is a bug"
    );
  }

  let newPreState: PreState = {
    ...preState,
    changesets: [...new Set([...preState.changesets, ...changesets])],
  };

  await fs.outputFile(
    preStatePath,
    JSON.stringify(newPreState, null, 2) + "\n"
  );
}
