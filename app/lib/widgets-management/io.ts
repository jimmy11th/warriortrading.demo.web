// Visit https://github.com/pubkey/broadcast-channel
import { BroadcastChannel } from "broadcast-channel";
import { useCallback, useEffect, useMemo } from "react";
import { Subject } from "rxjs";

import { config } from "../../config";
import { getBrowserAndOperatingSysInfo } from "../util/getBrowserAndOperatingSysInfo";
import { debug } from "./debug";
import { IWindowClient } from "./ioClient";
import { IWindowClientFilter, multiFilterClient } from "./ioClientFilter";
import { isHeartbeatMessage, IWindowMessage, MessageTypes } from "./ioMessage";

export interface IWindowIO {
  client: IWindowClient;
  channel: BroadcastChannel<IWindowMessage>;
  subject: Subject<IWindowMessage>;
}

export const useIO = (channelId: string, client: IWindowClient) => {
  debug(`will init IO useIO ${channelId}`);
  const channel = useMemo(() => newChannel(channelId), [channelId]);
  const subject = useMemo(() => new Subject<IWindowMessage>(), []);
  const io: IWindowIO = useMemo(
    () => ({
      channel,
      subject,
      client,
    }),
    [channel, client, subject]
  );

  const listener = useCallback(
    (msg: IWindowMessage) => {
      if (multiFilterClient(client, msg.receiversFilters)) {
        subject.next(msg);
      }
    },
    [client, subject]
  );

  useEffect(() => {
    channel.addEventListener("message", listener);
    return () => {
      channel.removeEventListener("message", listener);
    };
  }, [channel, listener]);

  return io;
};

export const initIO = (channelId: string, client: IWindowClient) => {
  const channel = newChannel(channelId);
  const subject = new Subject<IWindowMessage>();
  const io: IWindowIO = { channel, subject, client };

  const listener = (msg: IWindowMessage) => {
    if (multiFilterClient(client, msg.receiversFilters)) {
      subject.next(msg);
    }
  };
  channel.addEventListener("message", listener);

  debug(`will init IO`);

  return {
    io,
    complete: () => {
      debug(`will uninit IO`);

      channel.removeEventListener("message", listener);
      subject.complete();
    },
  };
};

export const send = (
  { channel, client, subject }: IWindowIO,
  type: MessageTypes,
  payload: any,
  receiversFilters: IWindowClientFilter[] = []
) => {
  const enableDebug =
    config().debug.windowManagementHeartbeat || !isHeartbeatMessage(type);
  enableDebug &&
    debug(
      `will send message (\n type: ${type}, \n payload: ${JSON.stringify(
        payload,
        null,
        2
      )}) to receiverFilters(${JSON.stringify(receiversFilters)})`
    );

  const msg: IWindowMessage = {
    sender: client,
    receiversFilters,
    type,
    payload,
  };
  if (multiFilterClient(client, receiversFilters)) {
    subject.next(msg);
  }
  return channel.postMessage(msg);
};

const channelName = (channelId: string) => {
  if (channelId == null || channelId.length === 0) {
    throw new Error("forbid to create a channel with empty channelId");
  }
  return `ares-windows-channel-${channelId}`;
};

const newChannel = (channelId: string) => {
  // select channel type
  // refs: https://caniuse.com/#feat=broadcastchannel
  const info = getBrowserAndOperatingSysInfo();
  const useNative =
    ["Windows", "Mac OS X"].includes(info.os || "") &&
    ["Firefox", "Chrome"].includes(info.browser || "");
  const channelType: "localstorage" | "native" = useNative
    ? "native"
    : "localstorage";

  debug(
    `will init IO channel with type(${channelType}) for os(${info.os}) and browser(${info.browser})`
  );
  return new BroadcastChannel<IWindowMessage>(channelName(channelId), {
    type: channelType, // (optional) enforce a type, oneOf['native', 'idb', 'localstorage', 'node']
    webWorkerSupport: true, // (optional) set this to false if you know that your channel will never be used in a WebWorker (increases performance)
  });
};
