import SiteSourceType from "@warriortrading/warriortrading.hermes.common.feathers/enums/siteSourceType";
import lodash from "lodash";
import { Subject } from "rxjs";

import { config } from "../../config";
import { getIds } from "../../layout";
import { parseNodeId, popUrl } from "../index";
import {
  layoutsLSManager,
  registerLocalStorageManagersProps,
  rottenWindowsLSManager,
} from "../local-storage-managers";
import { getSettings } from "../rest/settings";
import { FakeRoomIdPrefix, IProfile, PageType } from "../types";
import { EventBus } from "../util/eventBus";
import { messageOf } from "../util/message";
import { setProperty } from "../util/object";
import { getStorage, setStorage } from "../util/storage";
import { newUUID } from "../util/uuid";
import { sleep } from "../util/wait";
import { debug } from "./debug";
import { initIO, IWindowIO, send } from "./io";
import { isEqualClient, IWindowClient, newClient } from "./ioClient";
import {
  filtersWithId,
  filtersWithMain,
  filtersWithoutId,
  filtersWithPopouts,
  IWindowClientFilter,
} from "./ioClientFilter";
import {
  defaultSharedPropsState,
  ISharedPropsState,
  isValidSharedPropsState,
} from "./ioClientsSharedPropsStore";
import {
  IMainLayout,
  isEqualWidget,
  isIncludesWidget,
  IState,
  IWidget,
  widgetsInState,
} from "./ioClientsStore";
import { isHeartbeatMessage, IWindowMessage } from "./ioMessage";
import { LayoutDelegate } from "./layoutDelegate";

const debugHeartBeat = config().debug.windowManagementHeartbeat;
const RetryCheckMainCount = 0;
const heartbeatIntervalInMs =
  config().windowManagement.heartbeatIntervalInMs || 3000;
const storageVersion = config().localStorage.layouts.version;
const isPopoutScreecast = (p: IMainLayout) =>
  p.widgets[0] && p.widgets[0].type !== PageType.SCREENCAST;
export const getQueryItem = (itemName: string, must: boolean = false) => {
  const search = new URLSearchParams(window.location.search);
  const val = search.get(itemName);
  if (val == null && must) {
    throw new Error(`Missing parameter: ${itemName} in url`);
  }
  return val;
};

export class WidgetsManager {
  public delegate: LayoutDelegate;
  private session: string | undefined;
  private profile: IProfile | undefined;
  private popoutCloseWhiteList: string[] = [];
  private isInPopoutCloseWhiteList: boolean = false;
  private inited: boolean = false;
  private userId: string;
  private sourceCode: string;
  private io: IWindowIO;
  private closeIO: () => void;
  private blPopout: boolean;
  private mainUpdatedAt: number | undefined; //  popout only
  private popoutUpdatedAt: number | undefined; //  popout only
  private retryCheckMainIsAlive: number = 0; //  popout only
  private state: IState;
  private subjectOfState: Subject<IState>;
  private sharedPropsState: ISharedPropsState;
  private subjectOfSharedPropsState: Subject<ISharedPropsState>;
  private intervalId: number = -1;
  private roomIdLimit: { limited: boolean; ids: string[] } = {
    limited: false,
    ids: [],
  }; // main only
  private widgetTypeLimit: {
    [type: string]: {
      max: number;
      defaultRoomId?: string;
    };
  } = {}; // main only
  private customCommandListeners: {
    [commandType: string]: Array<
      (commandType: string, data: any, sender: IWindowClient) => void
    >;
  } = {};
  private mainId: string = "main";

  constructor() {
    debug("will init clients manager");
    this.blPopout = getQueryItem("popout") === "true";
    this.userId = getQueryItem("userId", true)!;
    this.sourceCode = getQueryItem("sourceCode", true)!;
    const pMainId = getQueryItem("mainId");
    this.session = getStorage(this.sourceCode, this.userId, "session");
    this.profile = getStorage(this.sourceCode, this.userId, "profile");
    this.mainId = pMainId != null && pMainId.length > 0 ? pMainId : this.mainId;
    debug(`*** mainId: ${this.mainId}, sourceCode: ${this.sourceCode}`);
    registerLocalStorageManagersProps({
      sourceCode: this.sourceCode,
      userId: this.userId,
      isBaseMain: this.isBaseMain(),
    });
    rottenWindowsLSManager().renew(this.mainId);
    this.delegate = this.initLayout();

    const { io, complete } = initIO(
      this.userId,
      newClient(
        !this.isBaseMain() ? "popout" : "main",
        this.blPopout ? undefined : this.mainId
      )
    );
    this.io = io;
    this.closeIO = complete;
    if (this.isPopout()) {
      this.mainId = this.io.client.id;
    }

    this.subjectOfState = new Subject<IState>();
    this.state = this.isMain()
      ? {
          version: 10000 + Math.round(Math.random() * 5000),
          main: {
            client: io.client,
            widgets: this.widgetsInLayout(),
          },
          widgetsOfBaseMain: [],
          popouts: [],
          openingPopouts: [],
        }
      : {
          version: -1,
          main: undefined,
          widgetsOfBaseMain: [],
          popouts: [
            {
              client: io.client,
              widgets: this.widgetsInLayout(),
            },
          ],
          openingPopouts: [],
        };

    this.subjectOfSharedPropsState = new Subject<ISharedPropsState>();
    this.sharedPropsState = this.initSharedPropsState();

    this.io.subject.subscribe((msg: any) => {
      if (this.inited) {
        this.recv(msg);
      }
    });

    this.inited = true;
    this.startInterval();
    this.startFetchSetting().then(() => {
      if (this.isBaseMain()) {
        this.sendToCloseWindows();
        this.initPopouts();
      } else {
        this.mainUpdatedAt = new Date().getTime();
        // save the init state to local storage
        this.onStateChanged();
      }
    });
  }

  public iLeave() {
    rottenWindowsLSManager().register(this.mainId);
    this.release();
  }

  public closeWidgetsInLayout(widgets: IWidget[]) {
    debug(
      `will close layout' widgets(\n${JSON.stringify(widgets, null, 2)}\n)`
    );

    widgets.forEach((widget: any) =>
      this.delegate.deleteWidget(widget.roomId, widget.type)
    );
    this.sendWidgetsAreClosed(widgets);
  }

  public closeCurrentBrowserPage(delayInMs: number, alert?: string) {
    debug(`will close current page ${delayInMs} ms later`);

    this.release();

    alert !== undefined && EventBus.emitToSnackbar("warning", alert);

    const close = async () => {
      try {
        if (this.isBaseMain()) {
          window.location.href = config().session.logoutUrl;
        } else if (this.isPopout()) {
          this.widgetsInLayout().forEach((widget: any) =>
            this.delegate.deleteWidget(widget.roomId, widget.type)
          );
        }
        await sleep(100);
      } catch (err) {
        console.error(err);
      } finally {
        window.close();
      }
    };

    if (delayInMs > 0) {
      setTimeout(() => {
        close();
      }, delayInMs);
    } else {
      close();
    }
  }

  public widgetsInLayout(): IWidget[] {
    const model = this.delegate.model;
    if (model === undefined) {
      return [];
    }

    const widgets: IWidget[] = [];
    Object.keys(getIds(model)).forEach((widgetId: any) => {
      try {
        const { roomId, page } = parseNodeId(widgetId);
        const node = {
          roomId,
          type: page,
        };
        widgets.push(node);
      } catch (err) {}
    });
    return widgets;
  }

  public isPopout() {
    return this.blPopout;
  }

  public isMain() {
    return !this.blPopout;
  }

  public isBaseMain() {
    return this.isMain() && this.mainId === "main";
  }

  public stateSnap() {
    return lodash.cloneDeep(this.state);
  }

  public subscribe(observer: (state: IState) => void) {
    return this.subjectOfState.subscribe(observer);
  }

  public sharedPropsStateSnap() {
    return lodash.cloneDeep(this.sharedPropsState);
  }

  public subscribeSharedPropsState(
    observer: (state: ISharedPropsState) => void
  ) {
    return this.subjectOfSharedPropsState.subscribe(observer);
  }

  public canAddWidget(widget: IWidget): { can: boolean; reason?: string } {
    // if (!this.isRoomIdValid(widget.roomId)) {
    //   return {
    //     can: false,
    //     reason: `roomId(${widget.roomId}) is invalid or limited`
    //   };
    // }

    const slotsCount = this.widgetSlotsCountOfType(widget.type);
    if (slotsCount <= 0) {
      return {
        can: false,
        reason: `too many widgets with type(${widget.type}) `,
      };
    }

    return { can: true };
  }

  public setRoomIdLimit(validRoomIds: string[]) {
    if (!this.isBaseMain()) {
      return;
    }

    const roomIds: string[] = validRoomIds.includes("All")
      ? validRoomIds
      : [...validRoomIds, "All"];

    debug(`to limit roomId in (\n${JSON.stringify(roomIds)}\n)`);
    this.roomIdLimit = { limited: true, ids: roomIds };

    this.widgetsWithInvalidRoomId().forEach((roomId: string) =>
      this.sendToCloseWidgets({ roomId }, [])
    );
  }

  public setScannerLimit(
    scannerTitles: {
      key: string;
      title: string;
      rank: number;
      accessable: boolean;
    }[]
  ) {
    widgetsInState(this.state).forEach((w: any) => {
      if (w.roomId.includes(FakeRoomIdPrefix)) {
        if (
          scannerTitles.length !== 0 &&
          !scannerTitles.find(
            (t: any) => t.key === w.roomId.replace(FakeRoomIdPrefix, "")
          )?.accessable
        ) {
          this.sendToCloseWidgets({ roomId: w.roomId }, []);
        }
      }
    });
  }

  public setWidgetTypeLimit(
    type: PageType,
    max: number,
    defaultRoomId?: string
  ) {
    if (!this.isBaseMain()) {
      return;
    }

    max = max < 0 || this.isInPopoutCloseWhiteList ? 1000 : max;
    const current = this.widgetTypeLimit[type];
    if (current !== undefined && current.max === max) {
      return;
    }

    debug(`to limit count of widget(type: ${type}) to [0, ${max}]`);
    this.widgetTypeLimit[type] = { max, defaultRoomId };

    // close all widgets with type if limit as 0
    if (max === 0) {
      this.sendToCloseWidgets({ type }, []);
      return;
    }

    const slotsCount = this.widgetSlotsCountOfType(type);
    if (slotsCount < 0) {
      this.sendToCloseWidgets(
        this.removeOverloadedWidgetsWithType(type, -slotsCount),
        []
      );
    }
  }

  public sendToOpenWidget(
    widget: IWidget,
    opts: {
      popout: boolean;
      mainId: string;
      toTabSetOfMain?: { openedType: PageType };
    } = {
      popout: false,
      mainId: "",
    }
  ) {
    const isPopoutWindow = !opts.popout && opts.mainId.length > 0;
    // Check the max layouts limit
    if (isPopoutWindow) {
      const popouts: IMainLayout[] =
        getStorage(this.sourceCode, this.userId, "popouts", storageVersion) ||
        [];
      // +2 should sub main
      const nextIndex = popouts.filter(isPopoutScreecast).length + 2;
      const limit = this.isInPopoutCloseWhiteList
        ? 1000
        : config().windowManagement.maxLayoutsLimit;
      debug(`*** sendToOpenWidget, ${nextIndex}/${limit}`);
      if (nextIndex > limit) {
        EventBus.emitToSnackbar("warning", messageOf("WDGT09LimitReached"));
        return false;
      }
    }
    // Check if the mainId is null
    if (!opts.popout && opts.mainId.length === 0) {
      opts.mainId = this.mainId;
    }
    debug(`sendToOpenWidget mainId: ${opts.mainId}`);
    // Send to main if it's a popout
    const filterClients =
      isPopoutWindow || opts.popout ? filtersWithMain() : this.filterMe();
    send(
      this.io,
      "To open widget",
      {
        widget,
        opts,
      },
      filterClients
    );
    return true;
  }

  public sendToCloseWidgets(
    widgetOpt: { type: string } | { roomId: string } | IWidget | IWidget[],
    receivers: IWindowClientFilter[]
  ) {
    send(this.io, "To close widgets", widgetOpt, receivers);
  }

  public sendWidgetsAreClosed(widgets: IWidget[]) {
    send(this.io, "Widgets are closed", widgets, this.filterMe());
  }

  public sendToCloseWindows(mainId?: string) {
    send(
      this.io,
      "To close windows",
      {},
      mainId == null ? filtersWithPopouts() : filtersWithId(mainId)
    );
  }

  public release() {
    debug("will release widgets manager");

    this.inited = false;
    this.subjectOfState.complete();
    this.clearInterval();
    this.closeIO();
  }

  public clearInterval() {
    if (this.intervalId >= 0) {
      debug("will clear interval of widgets manager jobs");

      clearInterval(this.intervalId);
      this.intervalId = -1;
    }
  }

  public sendPullSharedPropsState() {
    send(this.io, "<Shared Props> Pull state", {}, filtersWithMain());
  }

  // send to main to update shared props state
  public sendToUpdateSharedPropsState<K extends keyof ISharedPropsState>(
    key: K,
    val: ISharedPropsState[K]
  ) {
    if (key === "version") {
      console.warn("forbid to update shared props' state version");
      return;
    }
    send(
      this.io,
      "<Shared Props> To update state",
      { key, val },
      filtersWithMain()
    );
  }

  public filterMe() {
    return filtersWithId(this.io.client.id);
  }

  public registerCustomCommandListener(
    commandType: string,
    callback: (commandType: string, data: any, sender: IWindowClient) => void
  ) {
    if (this.customCommandListeners[commandType] === undefined) {
      this.customCommandListeners[commandType] = [];
    }

    if (!this.customCommandListeners[commandType].includes(callback)) {
      this.customCommandListeners[commandType].push(callback);
    }

    return () => {
      this.customCommandListeners[commandType] = this.customCommandListeners[
        commandType
      ].filter((cb: any) => cb !== callback);
      if (this.customCommandListeners[commandType].length === 0) {
        delete this.customCommandListeners[commandType];
      }
    };
  }

  public sendCustomCommand(
    commandType: string,
    data: any,
    receiversFilters: IWindowClientFilter[] = []
  ) {
    send(
      this.io,
      "<General> Custom command",
      { commandType, data },
      receiversFilters
    );
  }

  public recvCustomCommand(msg: IWindowMessage) {
    const { commandType, data } = msg.payload!;
    (this.customCommandListeners[commandType] || []).forEach((callback: any) =>
      callback(commandType, data, msg.sender)
    );
  }

  public getLayoutJSON() {
    return this.delegate.modelSnap().toJson();
  }

  public getMainId() {
    return this.mainId;
  }

  public getSourceCode() {
    return this.sourceCode;
  }

  public getUserId() {
    return this.userId;
  }

  private removeOverloadedWidgetsWithType(type: PageType, overload: number) {
    debug(
      `will close overloaded(count: ${overload}) widgets with type(${type})`
    );
    const limit = this.widgetTypeLimit[type];
    const widgetsToBeDeleted: IWidget[] = [];
    widgetsInState(this.state, type).forEach((widget: any) => {
      if (
        widget.roomId !== limit.defaultRoomId &&
        widgetsToBeDeleted.length < overload
      ) {
        widgetsToBeDeleted.push(widget);
      }
    });

    return widgetsToBeDeleted;
  }

  private isRoomIdValid(roomId: string) {
    return (
      roomId.startsWith("Charting_") ||
      !this.roomIdLimit.limited ||
      this.roomIdLimit.ids.includes(roomId) ||
      roomId.indexOf(FakeRoomIdPrefix) > -1
    );
  }

  private widgetSlotsCountOfType(type: PageType) {
    const limit = this.widgetTypeLimit[type];
    if (limit === undefined) {
      return 1000;
    }

    const widgetsWithType = widgetsInState(this.state, type);
    return limit.max - widgetsWithType.length;
  }

  private widgetsWithInvalidRoomId() {
    const invalidRoomIds: string[] = [];
    if (this.roomIdLimit.limited) {
      widgetsInState(this.state).forEach((widget: any) => {
        const roomId = widget.roomId;
        if (!this.isRoomIdValid(roomId) && !invalidRoomIds.includes(roomId)) {
          invalidRoomIds.push(roomId);
        }
      });
    }

    return invalidRoomIds;
  }

  private initLayout() {
    debug("will init layout");

    const jsonObject = this.blPopout ? {} : layoutsLSManager().get() ?? {};

    const json = jsonObject[this.mainId];
    const delegate = new LayoutDelegate(
      this.sourceCode,
      this.userId,
      this.mainId,
      json
    );
    debug(`*** init layout this.blPopout: ${this.blPopout}`);
    debug(
      `*** init layout mainId: ${this.mainId}, sourceCode:${this.sourceCode}, userId: ${this.userId}, storageVersion:${storageVersion}`
    );
    // if I am a popped out window, including popout and sub main windows
    if (!this.isBaseMain()) {
      const roomId = getQueryItem("roomId", true)!;
      const type = getQueryItem("page", true)! as PageType;
      delegate.addWidget(roomId, type);
    }
    return delegate;
  }

  private initPopouts() {
    debug("will init popouts after 1 second");
    setStorage(this.sourceCode, this.userId, "popouts", [], -1, storageVersion);
  }

  private initSharedPropsState() {
    debug("will init shared props state");
    if (!this.isBaseMain()) {
      return defaultSharedPropsState(-1);
    }

    let state: ISharedPropsState = getStorage(
      this.sourceCode,
      this.userId,
      "sharedPropsState",
      storageVersion
    );
    if (!isValidSharedPropsState(state)) {
      state = defaultSharedPropsState(-1);
    }
    state.version = 10000 + Math.round(Math.random() * 5000);

    return state;
  }

  private async startFetchSetting() {
    if (!this.session || !this.profile) {
      return [];
    }
    const res = await getSettings({
      session: this.session,
      roomId: this.profile.defaultRoomId,
      names: ["popoutCloseWhiteList"],
      sourceType: SiteSourceType.ALL,
    });
    this.popoutCloseWhiteList = res[0].value;
    this.isInPopoutCloseWhiteList = this.popoutCloseWhiteList.includes(
      this.userId
    );
  }

  private startInterval() {
    this.clearInterval();

    debug("will start interval of widgets manager jobs");

    const executeJob = () => {
      if (this.isBaseMain()) {
        // this.sendGeneralMainIsAlive();
        this.removeExpiredPopouts();
      } else {
        this.sendPopoutIsAlive();
        this.checkIsMainAlive();
      }
    };

    executeJob();

    this.intervalId = window.setInterval(executeJob, heartbeatIntervalInMs);
  }

  private isMainAlive() {
    return !rottenWindowsLSManager().isMainRotten();
  }

  private checkIsMainAlive() {
    if (this.isBaseMain()) {
      return;
    }
    debug(`*** this.isMainAlive(): ${this.isMainAlive()}`);
    // error in retries
    if (
      !this.isMainAlive() &&
      this.retryCheckMainIsAlive < RetryCheckMainCount
    ) {
      this.sendGeneralPopout(
        `*** pop 1-E this.mainUpdatedAt:${this.mainUpdatedAt}, this.popoutUpdatedAt:${this.popoutUpdatedAt}, this.retryCheckMainIsAlive:${this.retryCheckMainIsAlive}`
      );
      this.askIsMainAlive();
      this.retryCheckMainIsAlive++;
      return;
    }
    // error
    if (!this.isMainAlive() && !this.isInPopoutCloseWhiteList) {
      this.sendGeneralPopout(
        `*** pop 2-EE this.mainUpdatedAt:${this.mainUpdatedAt}, this.popoutUpdatedAt:${this.popoutUpdatedAt}`
      );
      debug("*** closeCurrentBrowserPage in checkIsMainAlive");
      this.closeCurrentBrowserPage(
        3000,
        messageOf("WDGT05MainIsClosed_", this.isMain() ? "layout" : "widget")
      );
      return;
    }

    // OK
    this.sendGeneralPopout(
      `*** pop 3-OK this.mainUpdatedAt:${this.mainUpdatedAt}, this.popoutUpdatedAt:${this.popoutUpdatedAt}`
    );
    debugHeartBeat && debug("main window is alive");
    this.retryCheckMainIsAlive = 0;
  }

  private onStateChanged(expiredPopouts?: string[]) {
    if (this.isInPopoutCloseWhiteList) {
      this.subjectOfState.next(this.stateSnap());
      return;
    }
    const layoutsObject = layoutsLSManager().get() ?? {};
    // streaming windows don't need to register in layouts
    if (this.isMain()) {
      layoutsObject[this.mainId] = this.delegate.modelSnap().toJson();
    }
    // Sync the state of popouts'
    if (this.isBaseMain()) {
      setStorage(
        this.sourceCode,
        this.userId,
        "popouts",
        this.state.popouts,
        -1,
        storageVersion
      );
      this.sendStateChanged();
    }

    // Remove expired layouts in local storage
    if (expiredPopouts != null) {
      expiredPopouts.forEach((popoutId: any) => {
        rottenWindowsLSManager().renew(popoutId);
        delete layoutsObject[popoutId];
      });
    }
    layoutsLSManager().set(layoutsObject);

    this.state.version = this.state.version + 1;
    debug(`state is changed to version(${this.state.version})`);
    this.subjectOfState.next(this.stateSnap());
  }

  private onSharedPropsStateChanged() {
    debug(
      `shared props state is changed to version(${this.sharedPropsState.version})`
    );

    this.sendSharedPropsStateChanged();

    setStorage(
      this.sourceCode,
      this.userId,
      "sharedPropsState",
      this.sharedPropsState,
      -1,
      storageVersion
    );
    this.subjectOfSharedPropsState.next(this.sharedPropsStateSnap());
  }

  private askIsMainAlive() {
    send(this.io, "Is main alive?", {}, filtersWithMain());
  }

  private sendGeneralMainIsAlive() {
    send(
      this.io,
      "<General> Main is alive",
      {
        version: this.state.version,
        mainCreatedAt: this.state.main!.client.createdAt,
        sharedPropsVersion: this.sharedPropsState.version,
      },
      filtersWithoutId(this.io.client.id)
    );
  }

  private recvGeneralMainIsAlive(msg: IWindowMessage) {
    if (isEqualClient(msg.sender, this.io.client)) {
      return;
    }

    if (!this.isBaseMain()) {
      this.mainUpdatedAt = new Date().getTime();
    }
    // Assume only popouts need to pull main state to local
    if (this.isPopout()) {
      if ((msg.payload!.version as number) !== this.state.version) {
        this.sendPullState();
      }
      if (
        (msg.payload!.sharedPropsVersion as number) !==
        this.sharedPropsState.version
      ) {
        this.sendPullSharedPropsState();
      }
    }
  }

  private sendPopoutIsAlive() {
    const widgets = this.widgetsInLayout();
    if (widgets.length === 0) {
      return;
    }

    if (!this.isBaseMain()) {
      send(this.io, "Popout is alive", widgets, filtersWithMain());
      this.popoutUpdatedAt = new Date().getTime();
    }
  }

  // 1. Update heartbeat
  // 2. Sync widgets in popouts
  private recvPopoutIsAlive(msg: IWindowMessage) {
    if (!this.isBaseMain()) {
      return;
    }

    const now = new Date().getTime();

    // popout exists
    const i = this.state.popouts.findIndex((popout: any) =>
      isEqualClient(popout.client, msg.sender)
    );

    if (i >= 0) {
      debugHeartBeat &&
        debug("*** updated: popout-" + this.state.popouts[i].client.id);
      const popout = this.state.popouts[i];
      popout.client.updatedAt = now;
      const newWidgets = msg.payload as IWidget[];
      // Update widgets in popouts when add/remove widgets
      if (newWidgets.length !== popout.widgets.length) {
        popout.widgets = newWidgets;
        this.onStateChanged();
      }
      return;
    }

    // popout not exists, add it when widget exists
    // remove opening popout
    const k = this.state.openingPopouts.findIndex((popout: any) =>
      isEqualClient(popout.client, msg.sender)
    );
    if (k >= 0) {
      debug("*** updated: remove opening popout");
      this.state.openingPopouts.splice(k, 1);
    }

    // add popouts to state
    this.state.popouts.push({
      client: { ...msg.sender, createdAt: now, updatedAt: now },
      widgets: msg.payload as IWidget[],
    });

    this.onStateChanged();
  }

  private sendGeneralPopout(message: string) {
    !this.isBaseMain() &&
      send(this.io, "<General> Popout message", message, filtersWithMain());
  }

  private recvGeneralPopout(msg: IWindowMessage) {
    if (!this.isBaseMain()) {
      return;
    }

    // popout exists
    const i = this.state.popouts.findIndex((popout: any) =>
      isEqualClient(popout.client, msg.sender)
    );
    if (i >= 0) {
      debugHeartBeat &&
        debug("*** message from: popout-" + this.state.popouts[i].client.id);
    }
  }

  // Ask for main state
  private sendPullState() {
    send(this.io, "Pull state", {}, filtersWithMain());
  }

  // Return main state
  private recvPullState(msg: IWindowMessage) {
    if (!this.isBaseMain()) {
      return;
    }

    this.sendStateChanged(msg.sender.id);
  }

  private recvPullSharedPropsState(msg: IWindowMessage) {
    if (!this.isBaseMain()) {
      return;
    }

    this.sendSharedPropsStateChanged(msg.sender.id);
  }

  public sendStateChanged(popoutId?: string) {
    send(
      this.io,
      "State changed",
      this.state,
      popoutId === undefined ? filtersWithPopouts() : filtersWithId(popoutId!)
    );
  }

  // Layouts and popouts receive the main state
  private recvStateChanged(msg: IWindowMessage) {
    if (this.isBaseMain() || msg.sender.id !== "main") {
      return;
    }
    // Don't change if I am a layout, update the state
    if (this.isMain()) {
      debug(
        `*** recv state changed from: main msg: ${JSON.stringify(msg, null, 2)}`
      );
      const mainState = (msg.payload as IState) || {};
      this.state.version = this.state.version + 1;
      this.state.popouts = mainState.popouts || [];
      this.state.widgetsOfBaseMain = mainState.main?.widgets || [];
      this.subjectOfState.next(this.stateSnap());
      debug(`*** this.state: ${JSON.stringify(this.state, null, 2)}`);
      return;
    }

    this.state = msg.payload!;
    this.subjectOfState.next(this.state);
  }

  private widgetOpenedStatus(widget: IWidget): "openedInMain" | "notopened" {
    const widgets = this.state.main
      ? this.state.main.widgets
      : ([] as IWidget[]);

    if (widgets.findIndex((w: any) => isEqualWidget(w, widget)) >= 0) {
      return "openedInMain";
    }

    return "notopened";
  }

  private recvToOpenWidget(msg: IWindowMessage) {
    if (this.isPopout()) {
      return;
    }

    // handle if widget opened
    const widget: IWidget = msg.payload!.widget;
    const widgetStatus = this.widgetOpenedStatus(widget);
    debug(`*** widgetStatus: ${widgetStatus}`);
    debug(`*** mainId1: ${msg.payload!.opts.mainId}, mainId2: ${this.mainId}`);

    if (
      widgetStatus === "openedInMain" &&
      msg.payload!.opts.mainId === this.mainId
    ) {
      // focus opened widget in layout
      this.delegate.addWidget(widget.roomId, widget.type);
      return;
    }

    // handle if widget is not opened
    const canAdd = this.canAddWidget(widget);
    if (!canAdd.can) {
      this.sendGeneralError(msg.sender.id, canAdd.reason!);
      return;
    }

    const opts: {
      popout: boolean;
      mainId: string;
      toTabSetOfMain?: { openedType: PageType };
    } = msg.payload!.opts;

    const needPopout = opts.popout || opts.mainId !== this.mainId;
    const windowType = opts.popout ? "popout" : "main";
    if (needPopout) {
      this.state.openingPopouts.push({
        client: newClient(windowType, "opening-" + newUUID(8, 16)),
        widgets: [widget],
      });

      const openFailed =
        null ==
        window.open(
          popUrl(
            widget.type,
            this.userId,
            this.sourceCode,
            widget.roomId,
            opts.mainId
          ),
          "_blank",
          this.blPopout
            ? "width=600,height=400,left=200,top=200"
            : "left=0,top=0"
        );

      if (openFailed) {
        EventBus.emitToSnackbar("error", messageOf("WDGT06PopoutFailed"));
      }
    } else {
      this.delegate.addWidget(widget.roomId, widget.type, opts.toTabSetOfMain);
      this.state.main!.widgets.push(widget);
    }

    this.onStateChanged();
  }

  private recvToCloseWidgets(msg: IWindowMessage) {
    const willClosedWidgets: IWidget[] = [];

    if (Array.isArray(msg.payload)) {
      this.widgetsInLayout().forEach((widget: any) => {
        if (isIncludesWidget(msg.payload as IWidget[], widget)) {
          willClosedWidgets.push(widget);
        }
      });
    } else {
      const type: string | undefined = msg.payload!.type;
      const roomId: string | undefined = msg.payload!.roomId;
      this.widgetsInLayout().forEach((widget: any) => {
        if (
          (widget.roomId === roomId || roomId === undefined) &&
          (widget.type === type || type === undefined)
        ) {
          willClosedWidgets.push(widget);
        }
      });
    }

    if (willClosedWidgets.length === 0) {
      return;
    }

    this.closeWidgetsInLayout(willClosedWidgets);

    if (this.isPopout()) {
      debug("*** closeCurrentBrowserPage in recvToCloseWidgets");
      this.closeCurrentBrowserPage(100);
    }
  }

  private recvToCloseWindows() {
    if (this.isBaseMain()) {
      return;
    }
    this.release();
    window.close();
  }

  private recvWidgetsAreClosed(msg: IWindowMessage) {
    if (this.isPopout()) {
      return;
    }

    const closedWidgets: IWidget[] = msg.payload!;
    const newMainWidgets = this.state.main!.widgets.filter(
      (widget: any) => !isIncludesWidget(closedWidgets, widget)
    );
    if (newMainWidgets.length !== this.state.main!.widgets.length) {
      this.state.main!.widgets = newMainWidgets;
      this.onStateChanged();
    }
  }

  private sendSharedPropsStateChanged(popoutId?: string) {
    send(
      this.io,
      "<Shared Props> State changed",
      this.sharedPropsState,
      popoutId === undefined ? filtersWithPopouts() : filtersWithId(popoutId!)
    );
  }

  private recvSharedPropsStateChanged(msg: IWindowMessage) {
    if (this.isBaseMain()) {
      return;
    }

    this.sharedPropsState = msg.payload!;
    this.subjectOfSharedPropsState.next(this.sharedPropsState);
  }

  private recvToUpdateSharedPropsState(msg: IWindowMessage) {
    if (!this.isBaseMain()) {
      return;
    }

    const { key, val } = msg.payload!;
    const newsharedPropsState = lodash.cloneDeep(this.sharedPropsState);
    setProperty(newsharedPropsState, key, val);
    newsharedPropsState.version = this.sharedPropsState.version + 1;

    this.sharedPropsState = newsharedPropsState;

    this.onSharedPropsStateChanged();
  }

  private sendGeneralError(windowId: string, err: string) {
    send(this.io, "<General> Error", err, filtersWithId(windowId));
  }

  private recvGeneralError(msg: IWindowMessage) {
    EventBus.emitToSnackbar("error", msg.payload! as string);
  }

  private recv(msg: IWindowMessage) {
    const enableDebug = debugHeartBeat || !isHeartbeatMessage(msg.type);
    enableDebug &&
      debug(
        `receive message from ${
          isEqualClient(msg.sender, this.io.client) ? "myself" : msg.sender.id
        }, \n type: ${msg.type}, \n payload: ${
          JSON.stringify(msg.payload, null, 2) || ""
        }`
      );

    switch (msg.type) {
      case "<General> Main is alive":
        return this.recvGeneralMainIsAlive(msg);
      case "<General> Error":
        return this.recvGeneralError(msg);
      case "<General> Custom command":
        return this.recvCustomCommand(msg);
      case "<General> Popout message":
        return this.recvGeneralPopout(msg);
      case "Is main alive?":
        return this.sendGeneralMainIsAlive();
      case "Popout is alive":
        return this.recvPopoutIsAlive(msg);
      case "Pull state":
        return this.recvPullState(msg);
      case "State changed":
        return this.recvStateChanged(msg);
      case "To open widget":
        return this.recvToOpenWidget(msg);
      case "To close widgets":
        return this.recvToCloseWidgets(msg);
      case "To close windows":
        return this.recvToCloseWindows();
      case "Widgets are closed":
        return this.recvWidgetsAreClosed(msg);
      case "<Shared Props> Pull state":
        return this.recvPullSharedPropsState(msg);
      case "<Shared Props> State changed":
        return this.recvSharedPropsStateChanged(msg);
      case "<Shared Props> To update state":
        return this.recvToUpdateSharedPropsState(msg);

      default:
        throw new Error(`receive IO message with invalid type: ${msg.type}`);
    }
  }

  private getExpiredPopouts(popouts: IMainLayout[]) {
    const newPopouts = (popouts ?? []).filter(
      (popout: IMainLayout) =>
        !rottenWindowsLSManager().isWindowRotten(popout.client.id)
    );
    const expiredPopoutIds = (popouts ?? [])
      .filter((popout: IMainLayout) =>
        rottenWindowsLSManager().isWindowRotten(popout.client.id)
      )
      .map((p: IMainLayout) => p.client.id);
    debug(
      `[RottenWindows] newPopouts: ${JSON.stringify(
        newPopouts,
        null,
        2
      )}, expiredPopoutIds: ${expiredPopoutIds.join(",")}.`
    );
    return { newPopouts, expiredPopoutIds };
  }

  public storeAllPopouts() {
    this.removeExpiredPopouts();
  }

  private removeExpiredPopouts() {
    if (!this.isBaseMain()) {
      return;
    }
    debug(
      `[RottenWindows] popouts: ${JSON.stringify(
        this.state.popouts,
        null,
        4
      )}, openingPopouts: ${JSON.stringify(this.state.popouts, null, 4)}`
    );
    let isChanged = false;
    const { newPopouts, expiredPopoutIds } = this.getExpiredPopouts(
      this.state.popouts
    );
    if (this.state.popouts.length !== newPopouts.length) {
      isChanged = true;
      this.state.popouts = newPopouts;
    }
    const {
      newPopouts: newOpeningPopouts,
      expiredPopoutIds: expiredOpeningIds,
    } = this.getExpiredPopouts(this.state.popouts);
    if (this.state.openingPopouts.length !== newOpeningPopouts.length) {
      isChanged = true;
      this.state.openingPopouts = newOpeningPopouts;
    }
    // save & broadcast changing
    if (isChanged) {
      debug(
        `removed some expired popouts from state, ${expiredPopoutIds.join(
          ","
        )}, opening:${expiredOpeningIds.join(",")}`
      );
      this.onStateChanged(expiredPopoutIds);
    }
  }
}
