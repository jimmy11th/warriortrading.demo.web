import { config } from "src/config";

import { getStorage, setStorage, StorageType } from "../util/storage";

const debugLocalStorage = config().debug.localStorage;

export interface IBaseManagerProps {
  storageVersion?: string;
  sourceCode?: string;
  userId?: string;
  isBaseMain?: boolean;
}

class StorageDebugger {
  private sourceCode: string;
  private userId: string;
  private logsDebug: boolean;

  constructor(sourceCode: string, userId: string, logsDebug?: boolean) {
    this.sourceCode = sourceCode;
    this.userId = userId;
    this.logsDebug = logsDebug ?? false;
  }

  public appendDebug(message: string) {
    const msg = `[${new Date().toISOString()}] ${message}`;
    if (!this.logsDebug) {
      debugLocalStorage &&
        console.debug(
          `[localStorage] msg: ${msg}, config.debug.localStorageLogsDebug isn't true`
        );
      return;
    }
    const msgs: string[] =
      getStorage(this.sourceCode, this.userId, "debug") ?? [];
    msgs.unshift(msg);
    setStorage(this.sourceCode, this.userId, "debug", msgs);
  }
}

export class BaseManager {
  private values: IBaseManagerProps;
  private name: StorageType;
  private emptyValue: unknown;
  protected storageDebugger: StorageDebugger;

  constructor(
    name: StorageType,
    emptyValue: unknown,
    props: IBaseManagerProps
  ) {
    this.name = name;
    this.values = props;
    this.emptyValue = emptyValue;
    this.storageDebugger = new StorageDebugger(
      this.getSourceCode(),
      this.getUserId(),
      config().debug.localStorageLogsDebug
    );
  }

  // public
  public get() {
    return (
      getStorage(
        this.getSourceCode(),
        this.getUserId(),
        this.name,
        this.values.storageVersion
      ) ?? this.emptyValue
    );
  }

  public set(data: any, expirationInSeconds?: number) {
    setStorage(
      this.getSourceCode(),
      this.getUserId(),
      this.name,
      data,
      expirationInSeconds,
      this.values.storageVersion
    );
  }

  // protected
  protected getSourceCode() {
    return this.values.sourceCode || "NG";
  }

  protected getUserId() {
    return this.values.userId || "NG";
  }
}
