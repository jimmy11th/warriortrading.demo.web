import { config } from "src/config";

import { StorageType } from "../util/storage";
import { BaseManager, IBaseManagerProps } from "./baseManager";
const rottenInMs = config().windowManagement.rottenInMs ?? 1000;

export interface RottenWindowsMap {
  [id: string]: number;
}

export class RottenWindows extends BaseManager {
  private version: number;
  constructor(
    name: StorageType,
    emptyValue: unknown,
    props: IBaseManagerProps
  ) {
    super(name, emptyValue, props);
    this.version = new Date().getTime();
    if (this.get() == null || props.isBaseMain) {
      this.set({ version: this.version });
    } else {
      this.version = this.get().version;
    }
  }

  public register(windowId: string) {
    const storageVersion = this.get().version;
    this.storageDebugger.appendDebug(
      `[register] mainId: ${windowId}, this.version: ${this.version}, storage version: ${storageVersion}.`
    );
    if (storageVersion !== this.version) {
      this.storageDebugger.appendDebug("[register] Do nothing");
      return;
    }
    const windowsMap = this.get();
    this.set({ ...windowsMap, [windowId]: new Date().getTime() });
  }

  public renew(windowId: string) {
    const windowsMap = this.get();
    if (windowsMap == null) return;
    delete windowsMap[windowId];
    this.set(windowsMap);
  }

  public isWindowRotten(windowId: string) {
    const windowsMap = this.get();
    const leaveAt = windowsMap[windowId];
    const isRotten =
      leaveAt != null && leaveAt + rottenInMs < new Date().getTime();
    return isRotten;
  }

  public isMainRotten() {
    return this.isWindowRotten("main");
  }

  public getVersion() {
    return this.version;
  }
}
