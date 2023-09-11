import { BaseManager } from "./baseManager";

export interface ICharts {
  [widgetId: string]: string;
}

export class Charts extends BaseManager {
  public appendCharts(data: ICharts) {
    const chartsMap = this.get();
    Object.assign(chartsMap, data);
    this.set(chartsMap);
  }
}
