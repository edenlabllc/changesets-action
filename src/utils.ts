import unified from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { exec } from "@actions/exec";
import resolveFrom from "resolve-from";
import { u } from "unist-builder";
// @ts-ignore
import mdastToString from "mdast-util-to-string";
import fs from "fs-extra";
import { getInput, InputOptions } from "@actions/core";
import { Node } from "unist";
import { UpgradedPackage } from "./run";

export const BumpLevels = {
  dep: 0,
  patch: 1,
  minor: 2,
  major: 3,
} as const;

export async function execWithOutput(
  command: string,
  args?: string[],
  options?: { ignoreReturnCode?: boolean; cwd?: string }
) {
  let myOutput = "";
  let myError = "";

  return {
    code: await exec(command, args, {
      listeners: {
        stdout: (data: Buffer) => {
          myOutput += data.toString();
        },
        stderr: (data: Buffer) => {
          myError += data.toString();
        },
      },

      ...options,
    }),
    stdout: myOutput,
    stderr: myError,
  };
}

export function extractPublishedPackages(
  line: string
): { name: string; version: string } | null {
  let newTagRegex = /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/;
  let match = line.match(newTagRegex);

  if (match === null) {
    let npmOutRegex = /Publishing "(.*?)" at "(.*?)"/;
    match = line.match(npmOutRegex);
  }

  if (match) {
    const [, name, version] = match;
    return { name, version };
  }

  return null;
}

export const requireChangesetsCliPkgJson = (cwd: string) => {
  try {
    return require(resolveFrom(cwd, "@changesets/cli/package.json"));
  } catch (err) {
    if (err && (err as any).code === "MODULE_NOT_FOUND") {
      throw new Error(
        `Have you forgotten to install \`@changesets/cli\` in "${cwd}"?`
      );
    }
    throw err;
  }
};

export const setupGitUser = async () => {
  await exec("git", ["config", "user.name", `"github-actions[bot]"`]);
  await exec("git", [
    "config",
    "user.email",
    `"github-actions[bot]@users.noreply.github.com"`,
  ]);
};

export async function configureNpmRc(npmToken: string) {
  let userNpmrcPath = `${process.env.HOME}/.npmrc`;

  if (fs.existsSync(userNpmrcPath)) {
    console.log("Found existing user .npmrc file");
    const userNpmrcContent = await fs.readFile(userNpmrcPath, "utf8");
    const authLine = userNpmrcContent.split("\n").find((line) => {
      // check based on https://github.com/npm/cli/blob/8f8f71e4dd5ee66b3b17888faad5a7bf6c657eed/test/lib/adduser.js#L103-L105
      return /^\s*\/\/registry\.npmjs\.org\/:[_-]authToken=/i.test(line);
    });
    if (authLine) {
      console.log(
        "Found existing auth token for the npm registry in the user .npmrc file"
      );
    } else {
      console.log(
        "Didn't find existing auth token for the npm registry in the user .npmrc file, creating one"
      );
      fs.appendFileSync(
        userNpmrcPath,
        `\n//registry.npmjs.org/:_authToken=${npmToken}\n`
      );
    }
  } else {
    console.log("No user .npmrc file found, creating one");
    fs.writeFileSync(
      userNpmrcPath,
      `//registry.npmjs.org/:_authToken=${npmToken}\n`
    );
  }
}

export function getBooleanInput(
  name: string,
  options?: InputOptions
): boolean | undefined {
  const trueValue = ["true", "True", "TRUE"];
  const falseValue = ["false", "False", "FALSE"];
  const val = getInput(name, options);
  if (trueValue.includes(val)) return true;
  if (falseValue.includes(val)) return false;
  return undefined;
}

export function getChangelogEntry(changelog: string, version: string) {
  let ast = unified().use(remarkParse).parse(changelog);

  let highestLevel: number = BumpLevels.dep;

  // @ts-ignore
  let nodes = ast.children as Array<any>;
  let headingStartInfo:
    | {
        index: number;
        depth: number;
      }
    | undefined;
  let endIndex: number | undefined;

  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (node.type === "heading") {
      let stringified: string = mdastToString(node);
      let match = stringified.toLowerCase().match(/(major|minor|patch)/);
      if (match !== null) {
        let level = BumpLevels[match[0] as "major" | "minor" | "patch"];
        highestLevel = Math.max(level, highestLevel);
      }
      if (headingStartInfo === undefined && stringified === version) {
        headingStartInfo = {
          index: i,
          depth: node.depth,
        };
        continue;
      }
      if (
        endIndex === undefined &&
        headingStartInfo !== undefined &&
        headingStartInfo.depth === node.depth
      ) {
        endIndex = i;
        break;
      }
    }
  }
  if (headingStartInfo) {
    // @ts-ignore
    ast.children = (ast.children as any).slice(
      headingStartInfo.index + 1,
      endIndex
    );
  }
  return ast;
}

export function concatChangelogEntries(
  changeLogs: { pkg: UpgradedPackage; ast: Node }[]
) {
  const children = changeLogs.flatMap(({ ast, pkg }) => {
    return [
      u("heading", { depth: 2 }, [u("text", `${pkg.name} v${pkg.version}`)]),
      // @ts-ignore
      ...ast.children,
    ];
  });
  const tree = u("root", children);
  return unified().use(remarkStringify).stringify(tree);
}
