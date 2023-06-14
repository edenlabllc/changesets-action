import { NewChangeset } from "@changesets/types";
import readChangesets from "@changesets/read";
import { Mode, PreState } from "./types";
import { enterPre, readPreState, updatePreState } from "./pre";

export type ChangesetState = {
  preState: PreState | undefined;
  changesets: NewChangeset[];
};

export default async function readChangesetState(
  mode: Mode,
  cwd: string = process.cwd(),
  since?: string
): Promise<ChangesetState> {
  let preState = await readPreState(cwd);
  let isInPreMode = preState?.mode === "snapshot" && mode === "snapshot";
  let changesets = await readChangesets(cwd, since);

  if (preState && isInPreMode) {
    // get diff between preState.changesets and changesets
    let changesetsToFilter = new Set(preState.changesets);
    changesets = changesets.filter((x) => !changesetsToFilter.has(x.id));
    // update preState.changesets to be changesets
    await updatePreState(
      changesets.map((x) => x.id),
      cwd
    );
  } else {
    await enterPre(
      mode,
      cwd,
      changesets.map((x) => x.id)
    );
  }

  return {
    preState: isInPreMode ? preState : undefined,
    changesets,
  };
}
