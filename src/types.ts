export type Mode = "snapshot" | "stable";

export type PreState = {
  mode: Mode;
  initialVersions: {
    [pkgName: string]: string;
  };
  changesets: string[];
};
