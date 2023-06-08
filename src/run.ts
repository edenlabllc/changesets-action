import {
  execWithOutput,
  extractPublishedPackages,
  requireChangesetsCliPkgJson,
} from "./utils";
import resolveFrom from "resolve-from";
import { simpleGit } from "simple-git";

type PublishOptions = {
  mode?: "snapshot" | "stable";
  tagName?: string;
  cwd?: string;
};

export type PublishedPackage = { name: string; version: string };

export type PublishResult =
  | {
      published: true;
      publishedPackages: PublishedPackage[];
    }
  | {
      published: false;
    };

export type UpgradedPackage = { name: string; version: string };

export type UpgradeResult = {
  upgraded: boolean;
  upgradedPackages: UpgradedPackage[];
};

export async function runVersion({
  mode,
  cwd = process.cwd(),
}: PublishOptions): Promise<UpgradeResult> {
  requireChangesetsCliPkgJson(cwd);
  console.info(`Running version workflow from cwd:`, cwd);

  let changesetVersionOutput = await execWithOutput(
    "node",
    [
      resolveFrom(cwd, "@changesets/cli/bin.js"),
      "version",
      mode === "snapshot" ? "--snapshot" : "",
    ],
    {
      cwd,
    }
  );

  if (changesetVersionOutput.code !== 0) {
    throw new Error(
      "Changeset command exited with non-zero code. Please check the output and fix the issue."
    );
  } else {
    console.info(`Changeset version workflow completed successfully.`);

    // get list of changed files
    const res = await simpleGit().status();
    // read only package.json files from the list
    const packageJsonFiles = res.modified.filter((file) =>
      file.includes("package.json")
    );
    // read package name and version from each package.json file
    const packages = packageJsonFiles.map((file) => {
      // read package.json file with fs
      console.log("File path:", resolveFrom(cwd, `./${file}`));
      const pkg = require(resolveFrom(cwd, `./${file}`));
      return { name: pkg.name, version: pkg.version };
    });

    return {
      upgraded: packages.length > 0,
      upgradedPackages: packages,
    };
  }
}

export async function runPublish({
  tagName,
  cwd = process.cwd(),
}: PublishOptions): Promise<PublishResult> {
  requireChangesetsCliPkgJson(cwd);
  console.info(`Running publish workflow...`);

  let changesetPublishOutput = await execWithOutput(
    "node",
    [
      resolveFrom(cwd, "@changesets/cli/bin.js"),
      "publish",
      "--no-git-tag",
      "--tag",
      tagName!,
    ],
    {
      cwd,
    }
  );

  if (changesetPublishOutput.code !== 0) {
    throw new Error(
      "Changeset command exited with non-zero code. Please check the output and fix the issue."
    );
  }

  let releasedPackages: PublishedPackage[] = [];

  for (let line of changesetPublishOutput.stdout.split("\n")) {
    let match = extractPublishedPackages(line);

    if (match === null) {
      continue;
    }

    releasedPackages.push(match);
  }

  const publishedAsString = releasedPackages
    .map((t) => `${t.name}_${t.version}`)
    .join("\n");

  const released = releasedPackages.length > 0;

  if (released) {
    console.info(
      `Published the following packages (total of ${releasedPackages.length}): ${publishedAsString}`
    );
  } else {
    console.info(`No packages were published...`);
  }

  if (releasedPackages.length) {
    return {
      published: true,
      publishedPackages: releasedPackages,
    };
  }

  return { published: false };
}
