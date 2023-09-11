import { BaseManager } from "./baseManager";
import { ICharts } from "./charts";

export interface IGroupItem {
  symbol: string;
  refresh?: boolean;
}

export interface IGroupsMap {
  [color: string]: IGroupItem;
}

export interface IWindowsColorMap {
  [windowId: string]: ICharts;
}

export interface IColorLinks {
  group: IGroupsMap;
  window: IWindowsColorMap;
}

export class ColorLinks extends BaseManager {}
