import { newUUID } from "../util/uuid";

export type WindowTypes = "main" | "popout";
export interface IWindowClient {
  id: string;
  type: WindowTypes;
  createdAt: number;
  updatedAt: number;
}

export const newClient = (type: WindowTypes, id?: string): IWindowClient => {
  const now = new Date().getTime();
  return {
    id: id || newUUID(8, 16),
    type,
    createdAt: now,
    updatedAt: now
  };
};

export const isEqualClient = (a: IWindowClient, b: IWindowClient) => {
  return a.id === b.id;
};
