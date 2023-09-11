import { config } from "../../config";

export const debug = (logs: any) => {
  config().debug.windowManagement &&
    console.debug("[Widgets Management]", new Date().getTime(), logs);
};
