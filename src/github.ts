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
  token: string;
  upgradeResult: UpgradeResult;
}) {
  const octokit = github.getOctokit(options.token);
  
  console.log(`GitHub context eventName: ${github.context.eventName}`);
  
  let issue_number = github.context.issue.number || github.context.payload.pull_request?.number;

  // If we don't have a PR number and this is a push event, try to find the associated PR
  if (!issue_number && github.context.eventName === 'push') {
    console.log('Push event detected, searching for associated pull request...');
    
    try {
      const sha = github.context.payload.after || github.context.sha;
      console.log(`Searching for PRs containing commit: ${sha}`);
      
      // Search for pull requests that contain this commit
      const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        ...github.context.repo,
        commit_sha: sha,
      });
      
      if (prs.length > 0) {
        // Use the first open PR found
        const openPr = prs.find(pr => pr.state === 'open') || prs[0];
        issue_number = openPr.number;
        console.log(`Found associated PR #${issue_number} (${openPr.state})`);
      } else {
        console.log('No associated pull requests found for this commit');
      }
    } catch (error) {
      console.log('Error searching for associated PR:', error);
    }
  }

  console.log(`Attempting to upsert comment for issue number: ${issue_number}`);

  if (!issue_number) {
    console.log(
      `Failed to locate a PR associated with the Action context, skipping Snapshot info comment...`
    );
    return;
  }

  let commentBody = options.upgradeResult.upgraded
    ? `### 🚀 Snapshot Release\n\nThe latest changes of this PR are available as:\n${formatTable(
        options.upgradeResult.upgradedPackages
      )}`
    : `Nothing was upgraded, so no snapshot comment will be posted.`;

  commentBody = `${SNAPSHOT_COMMENT_IDENTIFIER}\n${commentBody}`;
  console.log(`Comment body to be posted:\n${commentBody}`);

  if (!options.upgradeResult.upgraded) {
    console.log("Skipping comment creation because no packages were upgraded.");
    return;
  }

  const existingComments = await octokit.rest.issues.listComments({
    ...github.context.repo,
    issue_number,
    per_page: 100,
  });

  const existingComment = existingComments.data.find((v) =>
    v.body?.startsWith(SNAPSHOT_COMMENT_IDENTIFIER)
  );

  if (existingComment) {
    console.info(
      `Found an existing comment with id: ${existingComment.id}, doing a comment update...`,
      existingComment
    );

    const response = await octokit.rest.issues.updateComment({
      ...github.context.repo,
      body: commentBody,
      comment_id: existingComment.id,
    });

    console.log(`GitHub API response:`, response.status);
  } else {
    console.info(`Did not find an existing comment, creating a new comment...`);

    const response = await octokit.rest.issues.createComment({
      ...github.context.repo,
      body: commentBody,
      issue_number,
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
