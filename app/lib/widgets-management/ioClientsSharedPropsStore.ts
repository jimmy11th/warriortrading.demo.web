export interface ISharedPropsState {
  version: number;
  reportIssueStatus: "idle" | "reporting" | "reported" | "uploading";
}

export const defaultSharedPropsState = (
  version: number = -1
): ISharedPropsState => {
  return {
    version,
    reportIssueStatus: "idle"
  };
};

export const isValidSharedPropsState = (state: ISharedPropsState) => {
  if (state == null) {
    return false;
  }
  if (typeof state.version !== "number") {
    return false;
  }
  if (
    typeof state.reportIssueStatus !== "string" ||
    !["idle", "reporting", "reported", "uploading"].includes(
      state.reportIssueStatus
    )
  ) {
    return false;
  }

  return true;
};
