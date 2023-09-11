import {
  chartsLSManager,
  colorLinksLSManager,
  layoutsLSManager,
  watchListLSManager,
} from ".";
import { BaseManager } from "./baseManager";
import { ICharts } from "./charts";
import { IColorLinks } from "./colorLinks";
import { ILayouts } from "./layouts";
import { IWatchList } from "./watchList";
const layoutsJsonFileVersion = 2;

export interface ILayoutsBackup {
  updatedAt: number;
  uploadedAt: number;
  version: number;
  layouts: ILayouts;
  charts: ICharts;
  colorLinks: IColorLinks;
  watchList: IWatchList;
}

export class DefaultLayouts extends BaseManager {
  public getLayoutsUpdatedAt() {
    const backup: ILayoutsBackup = this.get();
    return backup?.updatedAt;
  }

  // restore layouts from remote s3 backup and local storage backup
  public async restoreLayouts() {
    const backup = this.get();
    if (backup != null) {
      backup.layouts && layoutsLSManager().set(backup.layouts);
      backup.charts && chartsLSManager().set(backup.charts);
      backup.colorLinks && colorLinksLSManager().set(backup.colorLinks);
      backup.watchList && watchListLSManager().set(backup.watchList);
    }
  }

  public backupLayouts() {
    const backup = {
      updatedAt: new Date().getTime(),
      uploadedAt: 0,
      version: layoutsJsonFileVersion,
      layouts: layoutsLSManager().get(),
      charts: chartsLSManager().get(),
      colorLinks: colorLinksLSManager().get(),
      watchList: watchListLSManager().get(),
    };
    this.set(backup);
  }
}
