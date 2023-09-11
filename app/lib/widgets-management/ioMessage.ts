import { IWindowClient } from "./ioClient";
import { IWindowClientFilter } from "./ioClientFilter";

export type MessageTypes =
  | "<General> Main is alive"
  | "<General> Error"
  | "<General> Custom command"
  | "<General> Popout message"
  | "Is main alive?"
  | "Popout is alive"
  | "Pull state"
  | "State changed"
  | "To open widget"
  | "To close widgets"
  | "To close windows"
  | "Widgets are closed"
  | "Window is closed"
  | "<Shared Props> Pull state"
  | "<Shared Props> State changed"
  | "<Shared Props> To update state";

export interface IWindowMessage {
  sender: IWindowClient;
  receiversFilters: IWindowClientFilter[];
  type: MessageTypes;
  payload?: any;
}

const heartbeatMessageTypes: MessageTypes[] = [
  "Popout is alive",
  "<General> Main is alive"
];
export const isHeartbeatMessage = (messageType: MessageTypes) => {
  return heartbeatMessageTypes.includes(messageType);
};
