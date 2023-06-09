import fs from "fs-extra";
import * as core from "@actions/core";
import { simpleGit } from "simple-git";
import { runVersion } from "./run";
import readChangesetState from "./readChangesetState";
import { execWithOutput, getBooleanInput, setupGitUser } from "./utils";
import {
  ALLOWED_RELEASE_NAME_DICTIONARIES,
  createRelease,
  upsertComment,
} from "./github";

(async () => {
  let githubToken = process.env.GITHUB_TOKEN;
  // let npmToken = process.env.NPM_TOKEN;

  if (!githubToken) {
    core.setFailed("Please add the GITHUB_TOKEN to the changesets action");
    return;
  }
  const releaseCodenames = core.getMultilineInput("release-codenames");

  const allowedCodenames = new Set(
    Object.keys(ALLOWED_RELEASE_NAME_DICTIONARIES)
  );
  const matchCodenames = [...new Set(releaseCodenames)].every((codename) =>
    allowedCodenames.has(codename)
  );

  if (!matchCodenames) {
    core.setFailed(
      `Invalid release codenames dictionaries, please use one of the following: ${Object.keys(
        ALLOWED_RELEASE_NAME_DICTIONARIES
      ).join(", ")}`
    );
    return;
  }

  // if (!npmToken) {
  //   core.setFailed("Please add the NPM_TOKEN to the changesets action");
  //   return;
  // }

  const inputCwd = core.getInput("cwd") || undefined;

  if (inputCwd) {
    console.log("changing directory to the one given as the input: ", inputCwd);
    process.chdir(inputCwd);
  }

  let shouldSetupGitUser = core.getBooleanInput("setup-git-user");

  if (shouldSetupGitUser) {
    console.log("setting git user");
    await setupGitUser();
  }

  // await configureNpmRc(npmToken);

  console.log("setting GitHub credentials");
  await fs.writeFile(
    `${process.env.HOME}/.netrc`,
    `machine github.com\nlogin github-actions[bot]\npassword ${githubToken}`
  );

  let { changesets } = await readChangesetState(inputCwd);
  let hasChangesets = changesets.length !== 0;
  core.setOutput("upgraded", "false");
  core.setOutput("upgraded-packages", "[]");
  core.setOutput("has-changesets", String(hasChangesets));

  if (!hasChangesets) {
    console.log("No changesets found");
    return;
  }

  let mode = core.getInput("mode") as "snapshot" | "stable";

  if (!mode) {
    core.setFailed(
      "Please configure the 'mode', choose between snapshot or stable mode."
    );

    return;
  }

  // check if mode is stable or snapshot
  if (!["stable", "snapshot"].includes(mode)) {
    core.setFailed(
      "Please configure the 'mode', choose between snapshot or stable mode."
    );
    return;
  }

  // remove refs/heads/ and refs/pull/ from GITHUB_REF_NAME
  const branchNameFormatter = (str: string | undefined) =>
    str?.replace(/^refs\/(heads|pull)\//, "")?.replaceAll(/[\/_]/g, "-");

  const isPullRequest = Boolean(process.env.GITHUB_HEAD_REF); //GITHUB_HEAD_REF is only set for pull request events https://docs.github.com/en/actions/reference/environment-variables

  let branchName;
  if (isPullRequest) {
    branchName = branchNameFormatter(process.env.GITHUB_HEAD_REF);
  } else {
    if (!process.env.GITHUB_REF) {
      throw new Error("GITHUB_EVENT_PATH env var not set");
    }
    branchName = branchNameFormatter(process.env.GITHUB_REF);
  }

  let snapshotTag = core.getInput("snapshot-tag") || branchName;
  const { upgraded, upgradedPackages } = await runVersion({
    tagName: snapshotTag,
    mode,
    cwd: inputCwd,
  });

  if (upgraded) {
    core.setOutput("upgraded", "true");
    core.setOutput("upgraded-packages", JSON.stringify(upgradedPackages));
    console.log("Upgraded packages:", JSON.stringify(upgradedPackages));
  }

  let prepareScript = core.getInput("prepare-script");

  if (prepareScript) {
    console.log(`Running user prepare script...`);
    let [publishCommand, ...publishArgs] = prepareScript.split(/\s+/);

    let userPrepareScriptOutput = await execWithOutput(
      publishCommand,
      publishArgs,
      { cwd: inputCwd }
    );

    if (userPrepareScriptOutput.code !== 0) {
      throw new Error("Failed to run 'prepare-script' command");
    }
  }

  // const result = await runPublish({
  //   tagName: mode,
  //   cwd: inputCwd,
  // });
  //
  // console.log("Publish result:", JSON.stringify(result));
  //
  // if (result.published) {
  //   core.setOutput("published", "true");
  //   core.setOutput(
  //     "publishedPackages",
  //     JSON.stringify(result.publishedPackages)
  //   );
  // }

  const shouldCreateCommit = getBooleanInput("commit") ?? mode === "stable";
  const shouldCreateTag =
    shouldCreateCommit && (getBooleanInput("tag") ?? mode === "stable");
  const shouldCreateGithubRelease =
    shouldCreateCommit &&
    (getBooleanInput("github-release") ?? mode === "stable");

  if (upgraded) {
    if (shouldCreateCommit) {
      await simpleGit(inputCwd).add(".").commit(`Version Packages`);
    }

    if (shouldCreateTag) {
      await Promise.all(
        upgradedPackages.map((pkg) =>
          simpleGit(inputCwd).addAnnotatedTag(
            `${pkg.name}_v${pkg.version}`,
            `${pkg.name} v${pkg.version}`
          )
        )
      );
    }
    if (shouldCreateCommit) {
      await simpleGit(inputCwd).push(["origin", "--follow-tags"]);
    }

    if (shouldCreateGithubRelease) {
      await createRelease({
        token: githubToken,
        upgradedPackages,
        releaseCodenames,
      });
    }
  }

  const shouldUpsertPRComment = getBooleanInput("comment") ?? mode !== "stable";

  if (shouldUpsertPRComment) {
    try {
      await upsertComment({
        token: githubToken,
        upgradeResult: { upgraded, upgradedPackages },
        tagName: mode,
      });
    } catch (e) {
      core.info(`Failed to create/update github comment.`);
      core.warning(e as Error);
    }
  }
})().catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});
