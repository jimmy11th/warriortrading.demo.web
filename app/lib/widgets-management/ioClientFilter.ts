import { IWindowClient, WindowTypes } from "./ioClient";

export interface IWindowClientFilter {
  propName: "type" | "id";
  method: "include" | "exclude";
  options: string[];
}

export const filtersWithType = (
  options: WindowTypes | WindowTypes[],
  method: "include" | "exclude" = "include"
): IWindowClientFilter[] => {
  return [
    {
      propName: "type",
      method,
      options: typeof options === "string" ? [options] : options
    }
  ];
};

export const filtersWithId = (
  options: string | string[],
  method: "include" | "exclude" = "include"
): IWindowClientFilter[] => {
  return [
    {
      propName: "id",
      method,
      options: typeof options === "string" ? [options] : options
    }
  ];
};

export const filtersWithPopouts = () => {
  return filtersWithType("popout");
};

export const filtersWithMain = () => {
  return filtersWithType("main");
};

export const filtersWithoutId = (options: string | string[]) => {
  return filtersWithId(options, "exclude");
};

export const filterClient = (
  client: IWindowClient,
  filter: IWindowClientFilter
) => {
  const propVal = client[filter.propName];
  return (
    (filter.method === "include") === (filter.options || []).includes(propVal)
  );
};

export const multiFilterClient = (
  client: IWindowClient,
  filters: IWindowClientFilter[]
) => {
  const len = filters.length;
  for (let i = 0; i < len; i++) {
    if (!filterClient(client, filters[i])) {
      return false;
    }
  }

  return true;
};
