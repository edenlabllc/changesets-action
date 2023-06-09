import path from "path";
import fs from "fs-extra";
import {
  uniqueNamesGenerator,
  Config,
  adjectives,
  animals,
  colors,
  countries,
  languages,
  names,
  starWars,
} from "unique-names-generator";
import { simpleGit } from "simple-git";
import startCase from "lodash.startcase";
import * as github from "@actions/github";
import { PublishedPackage, UpgradedPackage, UpgradeResult } from "./run";
import { concatChangelogEntries, getChangelogEntry } from "./utils";

const SNAPSHOT_COMMENT_IDENTIFIER = `<!-- changesetsSnapshotPrCommentKey -->`;

export const ALLOWED_RELEASE_NAME_DICTIONARIES = {
  adjectives,
  animals,
  colors,
  countries,
  languages,
  names,
  starWars,
};

function formatTable(packages: PublishedPackage[]): string {
  const header = `| Package | Version |\n|------|---------|`;

  return `${header}\n${packages
    .map((t) => `| \`${t.name}\` | \`${t.version}\` |`)
    .join("\n")}`;
}

export async function upsertComment(options: {
  tagName: string;
  token: string;
  upgradeResult: UpgradeResult;
}) {
  const octokit = github.getOctokit(options.token);
  const issueContext = github.context.issue;

  if (!issueContext?.number) {
    console.log(
      `Failed to locate a PR associated with the Action context, skipping Snapshot info comment...`
    );
    return;
  }

  let commentBody = options.upgradeResult.upgraded
    ? `### 🚀 Snapshot Release\n\nThe latest changes of this PR are available as:\n${formatTable(
        options.upgradeResult.upgradedPackages
      )}`
    : `Nothing were upgraded, since there are no linked \`changesets\` for this PR.`;

  commentBody = `${SNAPSHOT_COMMENT_IDENTIFIER}\n${commentBody}`;

  const existingComments = await octokit.rest.issues.listComments({
    ...github.context.repo,
    issue_number: issueContext.number,
    per_page: 100,
  });

  const existingComment = existingComments.data.find((v) =>
    v.body?.startsWith(SNAPSHOT_COMMENT_IDENTIFIER)
  );

  if (existingComment) {
    console.info(
      `Found an existing comment, doing a comment update...`,
      existingComment
    );

    const response = await octokit.rest.issues.updateComment({
      ...github.context.repo,
      body: commentBody,
      comment_id: existingComment.id,
    });

    console.log(`GitHub API response:`, response.status);
  } else {
    console.info(`Did not found an existing comment, creating comment..`);

    const response = await octokit.rest.issues.createComment({
      ...github.context.repo,
      body: commentBody,
      issue_number: issueContext.number,
    });

    console.log(`GitHub API response:`, response.status);
  }
}

export const createRelease = async ({
  cwd = process.cwd(),
  token,
  upgradedPackages,
  releaseCodenames,
}: {
  cwd?: string;
  token: string;
  upgradedPackages: UpgradedPackage[];
  releaseCodenames: string[];
}) => {
  try {
    const octokit = github.getOctokit(token);

    const changelogs = await Promise.all(
      upgradedPackages.map(async (pkg) => {
        let changelogFileName = path.join(cwd, pkg.path, "CHANGELOG.md");
        let changelog = await fs.readFile(changelogFileName, "utf8");
        let changelogEntry = getChangelogEntry(changelog, pkg.version);
        if (!changelogEntry) {
          // we can find a changelog but not the entry for this version
          // if this is true, something has probably gone wrong
          throw new Error(
            `Could not find changelog entry for ${pkg.name}_v${pkg.version}`
          );
        }
        return { pkg, ast: changelogEntry };
      })
    );

    const body = concatChangelogEntries(changelogs);
    let nickname = "";
    if (releaseCodenames.length) {
      const customConfig: Config = {
        dictionaries: releaseCodenames.map(
          // @ts-ignore
          (v) => ALLOWED_RELEASE_NAME_DICTIONARIES[v]
        ),
        separator: "-",
        length: releaseCodenames.length,
      };

      nickname = uniqueNamesGenerator(customConfig);
    }

    const nicknameHuman = nickname ? ` (${startCase(nickname)})` : "";
    const nicknameTag = nickname
      ? `-${nickname.replaceAll(" ", "-").toLowerCase()}`
      : "";

    const releaseName = `Release ${new Date()
      .toISOString()
      .slice(0, 10)}${nicknameHuman} 🚀`;
    const tagName = `release-${new Date()
      .toISOString()
      .slice(0, 10)}${nicknameTag}`;
    await simpleGit(cwd).addAnnotatedTag(tagName, releaseName);
    await simpleGit(cwd).push(["--tags"]);
    await octokit.rest.repos.createRelease({
      name: releaseName,
      tag_name: tagName,
      body,
      ...github.context.repo,
    });
  } catch (err) {
    // if we can't find a changelog, the user has probably disabled changelogs
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code !== "ENOENT"
    ) {
      throw err;
    }
  }
};
