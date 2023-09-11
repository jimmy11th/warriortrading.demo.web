import { config } from "src/config";

import { StorageType } from "../util/storage";
import { BaseManager, IBaseManagerProps } from "./baseManager";
import { Charts } from "./charts";
import { ColorLinks } from "./colorLinks";
import { DefaultLayouts } from "./defaultLayouts";
import { Layouts } from "./layouts";
import { RottenWindows } from "./rottenWindows";
import { WatchList } from "./watchList";

const storageConfig = config().localStorage;

export interface ILocalStorageMap {
  charts?: Charts;
  defaultLayouts?: DefaultLayouts;
  layouts?: Layouts;
  colorLinks?: ColorLinks;
  rottenWindows?: RottenWindows;
  watchList?: WatchList;
}

const globalProps: IBaseManagerProps = {};
const Managers: any = {};

const generator = (
  name: StorageType,
  emptyValue: unknown,
  classRef: typeof BaseManager,
  extraProps?: IBaseManagerProps
) => {
  return () => {
    if (Managers[name] == null) {
      Managers[name] = new classRef(
        name,
        emptyValue,
        Object.assign({}, globalProps, extraProps)
      );
    }
    return Managers[name];
  };
};

// Helper to set the global props that managers constructors used
export const registerLocalStorageManagersProps = (map: IBaseManagerProps) => {
  Object.assign(globalProps, map);
};

// All local storage managers defined here.
export const defaultLayoutsLSManager = generator(
  "defaultLayouts",
  {},
  DefaultLayouts
);
export const layoutsLSManager = generator("layouts", {}, Layouts, {
  storageVersion: storageConfig.layouts.version,
});
export const chartsLSManager = generator("chartLayout", {}, Charts);
export const colorLinksLSManager = generator("colorLink", {}, ColorLinks);
export const rottenWindowsLSManager = generator(
  "rottenWindows",
  {},
  RottenWindows
);
export const watchListLSManager = generator("watchList", {}, WatchList, {
  storageVersion: storageConfig.watchList.version,
});
