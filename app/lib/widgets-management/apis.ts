import {
  exportColorLink,
  initColorLink,
} from "@warriortrading/warriortrading.ares.color-group";
import { Action, Model, TabNode } from "FlexLayout";
import React, { useCallback } from "react";
import { config } from "src/config";
import {
  defaultLayoutsLSManager,
  layoutsLSManager,
} from "src/lib/local-storage-managers";

import { PageType } from "../types";
import { setStorage } from "../util/storage";
import { newUUID } from "../util/uuid";
import { sleep } from "../util/wait";
import { IWindowClient } from "./ioClient";
import { IWindowClientFilter } from "./ioClientFilter";
import { ISharedPropsState } from "./ioClientsSharedPropsStore";
import {
  isEqualWidget,
  isIncludesWidget,
  IState,
  IWidget,
  widgetsInState,
} from "./ioClientsStore";
import { WidgetsManager } from "./widgetsManager";

const debug = config().debug.windowManagement;

let globalManager: WidgetsManager | undefined;

export const manager = (): WidgetsManager => {
  if (globalManager === undefined) {
    globalManager = new WidgetsManager();
  }

  return globalManager;
};

export const releaseManager = () => {
  if (globalManager !== undefined) {
    globalManager.release();
    globalManager = undefined;
  }
};

export const closeMyWidget = (widget: IWidget) => {
  const m = manager();
  if (m.isPopout()) {
    m.clearInterval();
  }

  m.closeWidgetsInLayout([widget]);

  if (m.isPopout()) {
    m.closeCurrentBrowserPage(100);
  }
};

export const toCloseWidgets = (
  widgetOpt: { type: string } | { roomId: string } | IWidget,
  receivers: IWindowClientFilter[]
) => {
  manager().sendToCloseWidgets(widgetOpt, receivers);
};

export const toOpenWidget = (
  widget: IWidget,
  opts: {
    popout: boolean;
    mainId: string;
    toTabSetOfMain?: { openedType: PageType };
  } = {
    popout: false,
    mainId: "",
  }
) => {
  manager().sendToOpenWidget(widget, opts);
};

export const toPopout = (widget: IWidget) => {
  const m = manager();
  if (m.isPopout()) {
    debug && console.debug("toPopout: isPopout");
    return;
  }

  m.closeWidgetsInLayout([widget]);
  m.sendToOpenWidget(widget, { popout: true, mainId: "" });
};

export const toPopMain = (widget: IWidget, mainId: string) => {
  const m = manager();
  debug && console.debug("*** toPopMain:", widget, mainId);

  if (m.isPopout()) {
    debug && console.debug("toPopMain: isPopout");
    return;
  }
  if (m.sendToOpenWidget(widget, { popout: false, mainId })) {
    m.closeWidgetsInLayout([widget]);
  }
};

export const getLayoutWidgetsCount = () => {
  const m = manager();
  const widgets = m.widgetsInLayout();
  return widgets.length;
};

export const doLayoutAction = (payload: Action) => {
  return manager().delegate.doAction(payload);
};

export const getLayoutNode = (nodeId: string) => {
  return manager().delegate.model.getNodeById(nodeId) as TabNode;
};

export const isWidgetOpened = (widget: IWidget, state: IState) => {
  return isIncludesWidget(widgetsInState(state, widget.type), widget);
};

export const useWidgetsState = () => {
  const [state, setState] = React.useState<IState>(manager().stateSnap());

  React.useEffect(() => {
    const subscribe = manager().subscribe((s: IState) => {
      setState(s);
    });

    return () => subscribe.unsubscribe();
  }, []);

  return state;
};

const isScreencastOpened = (state: IState, widget: IWidget) => {
  // Find main
  const mainWidgets =
    (manager().isBaseMain() ? state.main?.widgets : state.widgetsOfBaseMain) ||
    [];
  for (const w of mainWidgets) {
    if (isEqualWidget(w, widget)) {
      return true;
    }
  }

  // Find popouts
  for (const p of state.popouts) {
    for (const w of p.widgets) {
      if (isEqualWidget(w, widget)) {
        return true;
      }
    }
  }
  return false;
};

export const useWidgetOpened = (widget: IWidget) => {
  const widgetRef = React.useRef(widget);
  const localState = manager().stateSnap();
  const localOpened = isWidgetOpened(widgetRef.current, localState);

  const calcOpened = useCallback((state: IState, newOpened: boolean) => {
    return widgetRef.current.type === PageType.SCREENCAST
      ? isScreencastOpened(state, widgetRef.current)
      : newOpened;
  }, []);

  const [opened, setOpened] = React.useState<boolean>(
    calcOpened(localState, localOpened)
  );

  React.useEffect(() => {
    let current: boolean | undefined;
    const subscribe = manager().subscribe((s: IState) => {
      const newOpened = isWidgetOpened(widgetRef.current, s);
      const newVal = calcOpened(s, newOpened);
      // debug && console.log("*** useWidgetOpened, newVal, s, newOpened:", newVal, s, newOpened);

      if (newVal !== current) {
        current = newVal;
        setOpened(newVal);
        // Tell all the popouts to update their opened state
        manager().sendStateChanged();
      }
    });

    return () => subscribe.unsubscribe();
  }, [calcOpened, widgetRef]);

  return opened;
};

export const useLayoutModel = () => {
  const [model, setModel] = React.useState(manager().delegate.model);

  React.useEffect(() => {
    setModel(manager().delegate.model);
    const subscribe = manager().delegate.subscribe((m: Model) => {
      setModel(m);
    });

    return () => {
      subscribe.unsubscribe();
    };
  }, [model]);

  return model;
};

export const updateSharedPropsState = <K extends keyof ISharedPropsState>(
  key: K,
  val: ISharedPropsState[K]
) => {
  manager().sendToUpdateSharedPropsState(key, val);
};

export const useGeneralState = () => {
  const [state, setState] = React.useState<ISharedPropsState>(
    manager().sharedPropsStateSnap()
  );

  React.useEffect(() => {
    const subscribe = manager().subscribeSharedPropsState(
      (s: ISharedPropsState) => {
        setState(s);
      }
    );

    return () => subscribe.unsubscribe();
  }, []);

  return state;
};

export const sendReportIssueUrl = (
  url: string,
  receiversFilters: IWindowClientFilter[] = []
) => {
  manager().sendCustomCommand("SendReportIssueUrl", { url }, receiversFilters);
};

export const registerRecvReportIssueUrl = (callback: (url: string) => void) => {
  const cb = (commandType: string, data: any, sender: IWindowClient) => {
    callback(data.url);
  };

  return manager().registerCustomCommandListener("SendReportIssueUrl", cb);
};

export const openSubMains = (sourceCode: string, userId: string) => {
  const m = manager();
  if (!m.isBaseMain()) {
    return;
  }
  const jsonObject = layoutsLSManager().get() ?? {};
  const subMainIds = Object.keys(jsonObject).filter(
    (mId: any) => mId !== "main"
  );
  debug && console.debug(`*** start to pop mains: ${subMainIds.join(",")}`);
  subMainIds.forEach(async (mId: any, index: any) => {
    await sleep(3000 * (1 + index));
    debug && console.debug(`*** new mainId: ${mId}`);
    m.sendToOpenWidget(
      { roomId: mId, type: PageType.EMPTY },
      { popout: false, mainId: mId }
    );
  });
};

export const popoutNewLayout = (
  sourceCode: string,
  userId: string,
  layoutJSON: string
) => {
  const layoutObject = JSON.parse(layoutJSON);
  const mainId = newUUID(4, 16);
  const jsonObject = layoutsLSManager().get() ?? {};
  jsonObject[mainId] = layoutObject.layout;

  if (layoutObject) {
    setStorage(sourceCode, userId, "chartLayout", layoutObject.charts);
    if (layoutObject.colorLink) {
      const currentColorLinkData = exportColorLink();
      initColorLink(sourceCode, userId, undefined, {
        ...layoutObject.colorLink,
        window: {
          ...currentColorLinkData.window,
          [mainId]: layoutObject.colorLink.window.main,
        },
      });
    }
  }

  layoutsLSManager().set(jsonObject);
  manager().sendToOpenWidget(
    { roomId: mainId, type: PageType.EMPTY },
    { popout: false, mainId }
  );
};

export const getSelectedRoom = () => {
  return manager().delegate.getSelectedRoom();
};

export const saveAndCloseAllWindows = async () => {
  saveAllWindows();
  manager().sendToCloseWindows();
};

export const saveAllWindows = async () => {
  manager().storeAllPopouts();
  defaultLayoutsLSManager().backupLayouts();
};
