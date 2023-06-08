import * as core from "@actions/core";
import fs from "fs-extra";
import { simpleGit } from "simple-git";
import { runPublish, runVersion } from "./run";
import readChangesetState from "./readChangesetState";
import {
  configureNpmRc,
  execWithOutput,
  getBooleanInput,
  setupGitUser,
} from "./utils";
import { upsertComment } from "./github";

(async () => {
  let githubToken = process.env.GITHUB_TOKEN;
  let npmToken = process.env.NPM_TOKEN;

  if (!githubToken) {
    core.setFailed("Please add the GITHUB_TOKEN to the changesets action");
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

  let shouldSetupGitUser = core.getBooleanInput("setupGitUser");

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

  // core.setOutput("published", "false");
  // core.setOutput("publishedPackages", "[]");
  core.setOutput("upgraded", "false");
  core.setOutput("upgradedPackages", "[]");
  core.setOutput("hasChangesets", String(hasChangesets));

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

  const { upgraded, upgradedPackages } = await runVersion({
    mode,
    cwd: inputCwd,
  });

  if (upgraded) {
    core.setOutput("upgraded", "true");
    core.setOutput("upgradedPackages", JSON.stringify(upgradedPackages));
    console.log("Upgraded packages:", JSON.stringify(upgradedPackages));
  }

  let prepareScript = core.getInput("prepareScript");

  if (prepareScript) {
    console.log(`Running user prepare script...`);
    let [publishCommand, ...publishArgs] = prepareScript.split(/\s+/);

    let userPrepareScriptOutput = await execWithOutput(
      publishCommand,
      publishArgs,
      { cwd: inputCwd }
    );

    if (userPrepareScriptOutput.code !== 0) {
      throw new Error("Failed to run 'prepareScript' command");
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

  if (upgraded) {
    if (shouldCreateCommit) {
      await simpleGit(inputCwd).add(".").commit(`Version Packages`);
    }

    if (shouldCreateTag) {
      await Promise.all(
        upgradedPackages.map((pkg) =>
          simpleGit(inputCwd).addAnnotatedTag(
            `${pkg.name}_${pkg.version}`,
            `${pkg.name} ${pkg.version}`
          )
        )
      );
    }
    if (shouldCreateCommit) {
      await simpleGit(inputCwd).push(["origin", "--follow-tags"]);
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
