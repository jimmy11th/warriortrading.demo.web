import { PageType } from "../types/enums";
import { IWindowClient } from "./ioClient";
export interface IWidget {
  type: PageType;
  roomId: string;
}

export interface IWidgetWithUserId extends IWidget {
  userId?: string;
  mainId?: string;
}

export interface IMainLayout {
  client: IWindowClient;
  widgets: IWidgetWithUserId[];
}

export interface IState {
  version: number;
  main: IMainLayout | undefined;
  // Used by layouts
  widgetsOfBaseMain: IWidgetWithUserId[];
  popouts: IMainLayout[];
  openingPopouts: IMainLayout[];
}

export const widgetkey = (widget: IWidget) => widget.type + "-" + widget.roomId;
export const isEqualWidget = (a: IWidget, b: IWidget) =>
  a.roomId === b.roomId && a.type === b.type;

export const isIncludesWidget = (a: IWidget[], w: IWidget) => {
  for (let index = 0; index < a.length; index++) {
    if (isEqualWidget(w, a[index])) {
      return true;
    }
  }

  return false;
};

export const widgetsInState = (
  state: IState,
  type?: PageType
) => {
  const widgets: IWidgetWithUserId[] = [];
  state.main &&
    state.main.widgets.forEach((w: any) => {
      if (type === undefined || type === w.type) {
        widgets.push(w);
      }
    });
  return widgets;
};
