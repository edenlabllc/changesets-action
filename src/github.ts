import * as github from "@actions/github";

import { PublishedPackage, PublishResult, UpgradeResult } from "./run";

const SNAPSHOT_COMMENT_IDENTIFIER = `<!-- changesetsSnapshotPrCommentKey -->`;

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
