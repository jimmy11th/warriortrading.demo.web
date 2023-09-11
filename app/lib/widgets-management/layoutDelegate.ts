import { Action, Actions, DockLocation, Model } from "FlexLayout";
import { Subject } from "rxjs";
import { config } from "src/config";
import { DIRECTION, emptylayoutJson, findNodeId } from "src/layout";
import { buildNodeId, parseNodeId } from "src/lib";
import { layoutsLSManager } from "src/lib/local-storage-managers";
import { IJsonType, PageType } from "src/lib/types";
import { calcMobileDevice } from "src/lib/util/getMobileDevice";
import { messageOf } from "src/lib/util/message";

const debug = config().debug.layout;

export function isNodeExist(model: Model, nodeId: string) {
  return model.getNodeById(nodeId) != null;
}

export function isNodeShown(model: Model, nodeId: string) {
  const node = model.getNodeById(nodeId);
  return node != null && node.isVisible();
}
export class LayoutDelegate {
  public model!: Model;
  private userId: string;
  private sourceCode: string;
  private subject: Subject<Model>;
  // index for the main layouts array;
  private mainId: string;
  constructor(sourceCode: string, userId: string, mainId: string, json?: any) {
    this.sourceCode = sourceCode;
    this.userId = userId;
    this.mainId = mainId;
    this.subject = new Subject<Model>();
    this.initModel(json);
  }
  public initModel(json?: any) {
    try {
      // always use the latest global setting of the empty layout
      return this.updateModel(
        Model.fromJson(
          json == null
            ? emptylayoutJson
            : { ...json, global: emptylayoutJson.global }
        )
      );
    } catch (err) {
      return this.updateModel(Model.fromJson(emptylayoutJson));
    }
  }

  public getSelectedRoom() {
    const id = this.model.getActiveTabset()?.getChildren()[0]?.getId();
    if (id && id.startsWith("Room")) {
      return id.split("_").pop();
    }
    return undefined;
  }

  public addWidget(
    roomId: string,
    type: PageType,
    toTab?: {
      openedType: PageType;
    }
  ) {
    const nodeId = buildNodeId({
      page: type,
      roomId,
    });

    // case 1: select node if exists
    if (isNodeExist(this.model, nodeId)) {
      return this.doAction(Actions.selectTab(nodeId));
    }

    // Prepare name and enableClose for the rest cases.
    let name = "";
    let enableClose = false;
    if (type === PageType.ANNOUNCEMENTS) {
      name = "Announcements";
      enableClose = true;
    } else if (type === PageType.PRIVATE_CHATS) {
      name = messageOf("PCHA04PrivateChat");
      enableClose = true;
    }

    // case 2: add node to existed tabset
    if (toTab !== undefined) {
      const brotherId = buildNodeId({
        page: toTab.openedType,
        roomId,
      });

      const brotherNode = this.model.getNodeById(brotherId);
      if (brotherNode && brotherNode.getType() === "tab") {
        const parentNode = brotherNode.getParent();
        if (parentNode != null) {
          const nodeJSON: IJsonType = {
            type: "tab",
            id: nodeId,
            component: type,
            name,
            enableClose,
          };
          // change value of case 3 enableClose:false to true, when there are more than one widget in the same tabset
          if (enableClose) {
            this.doAction(
              Actions.updateNodeAttributes(brotherId, {
                ...brotherNode.toJson(),
                enableClose: true,
              })
            );
          }
          return this.doAction(
            Actions.addNode(
              nodeJSON,
              parentNode.getId(),
              DockLocation.CENTER,
              0
            )
          );
        }
      }
    }

    // case 3: add node to new tabset
    const rule = {
      1: {
        nextDirection: DIRECTION.RIGHT,
        max: 2,
      },
      default: {
        nextDirection: DIRECTION.BOTTOM,
        max: 2,
      },
    };

    const target = findNodeId(this.model.getRoot(), rule);
    if (target != null) {
      const toNodeId = target.toNodeId;
      const location = target.location;
      const nodeJSON: IJsonType = {
        type: "tab",
        id: nodeId,
        component: type,
        name,
        enableClose: false,
      };

      const tempModel = this.modelSnap();
      tempModel.doAction(Actions.addNode(nodeJSON, toNodeId, location, -1));
      if (target.resize === true) {
        const children = tempModel
          .getNodeById(nodeId)
          .getParent()!
          .getParent()!
          .getChildren();
        if (children != null) {
          const aveWeight = 100 / children.length;
          for (const child of children) {
            tempModel.doAction(
              Actions.updateNodeAttributes(child.getId(), {
                weight: aveWeight,
              })
            );
          }
        }
      }
      return this.updateModel(tempModel);
    }
    return this.model;
  }

  public deleteWidget(roomId: string, type: PageType) {
    const nodeId = buildNodeId({ page: type, roomId });
    if (!isNodeExist(this.model, nodeId)) {
      return this.model;
    }

    const tempModel = this.modelSnap();
    const parentNode = tempModel.getNodeById(nodeId).getParent();
    tempModel.doAction(Actions.deleteTab(nodeId));

    // if the tabset has only one tab left, remove the close button of it.
    const siblings = parentNode?.getChildren();
    if (siblings && siblings.length === 1) {
      const brotherNode = siblings[0];
      tempModel.doAction(
        Actions.updateNodeAttributes(brotherNode.getId(), {
          ...brotherNode.toJson(),
          enableClose: false,
        })
      );
    }

    return this.updateModel(tempModel);
  }

  // Action data example
  // {
  //     "type": "FlexLayout_AdjustSplit",
  //     "data": {
  //         "node1": "#4",
  //         "weight1": 40.16483516483517,
  //         "pixelWidth1": 731,
  //         "node2": "#1",
  //         "weight2": 59.83516483516483,
  //         "pixelWidth2": 1089
  //     }
  // }
  public doAction(action: Action) {
    debug && console.log("*** doAction:", action);
    // skip rename action when the widget is not exist
    if (
      action.type === Actions.RENAME_TAB &&
      !isNodeExist(this.model, action.data.node)
    ) {
      debug && console.log("*** RENAME_TAB widget does not exist");
      return this.model;
    }
    // Change the action data when adjust split
    if (action.type === Actions.ADJUST_SPLIT) {
      debug && console.log("*** doAction adjust_split");
      const { pixelWidth1, pixelWidth2 } = action.data;
      const minWidth = calcMobileDevice().isMobile
        ? config().windowManagement.layoutModel.mobileMinWidth
        : config().windowManagement.layoutModel.PCMinWidth;
      if (Math.min(minWidth, pixelWidth1, pixelWidth2) !== minWidth) {
        const [smallIndex, bigIndex] =
          pixelWidth1 > pixelWidth2 ? ["2", "1"] : ["1", "2"];
        const [smallWidth, bigWidth] = [
          action.data[`pixelWidth${smallIndex}`],
          action.data[`pixelWidth${bigIndex}`],
        ];
        const [smallWeight, bigWeight] = [
          action.data[`weight${smallIndex}`],
          action.data[`weight${bigIndex}`],
        ];
        const widthDiff = minWidth - smallWidth;
        const weightDiff =
          (widthDiff * (smallWeight + bigWeight)) / (smallWidth + bigWidth);
        action.data[`pixelWidth${smallIndex}`] += widthDiff;
        action.data[`pixelWidth${bigIndex}`] -= widthDiff;
        action.data[`weight${smallIndex}`] += weightDiff;
        action.data[`weight${bigIndex}`] -= weightDiff;
        debug &&
          console.log(
            "*** adjust_split minWidth reached, smallWidth, widthDiff, weightDiff, action.data:",
            smallWidth,
            widthDiff,
            weightDiff,
            action.data
          );
      }
    }
    if (action.type === Actions.MOVE_NODE) {
      const targetNode = this.model.getNodeById(action.data.toNode);
      if (
        targetNode.getType() === "tabset" &&
        action.data.location === "center"
      ) {
        return this.model;
      }
      try {
        const { page } = parseNodeId(action.data.fromNode); // if nodeId is #... like.This function will throw an error
        if (
          page === PageType.ANNOUNCEMENTS ||
          page === PageType.PRIVATE_CHATS
        ) {
          return this.model;
        }
      } catch (error) {}
    }

    // Do the action.
    const tempModel = this.modelSnap();
    tempModel.doAction(action);

    if ([Actions.ADJUST_SPLIT, Actions.MOVE_NODE].includes(action.type)) {
      const jsonObject = layoutsLSManager().get() ?? {};
      jsonObject[this.mainId] = tempModel.toJson();
      layoutsLSManager().set(jsonObject);
    }
    return this.updateModel(tempModel);
  }

  public subscribe(next: (model: Model) => void) {
    return this.subject.subscribe(next);
  }

  private updateModel(model: Model) {
    this.model = model;
    this.subject.next(model);
    return model;
  }

  public modelSnap() {
    return Model.fromJson(this.model.toJson());
  }
}
