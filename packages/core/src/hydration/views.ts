/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DEHYDRATED_VIEWS, LContainer} from '../render3/interfaces/container';
import {RNode} from '../render3/interfaces/renderer_dom';

import {removeDehydratedViews} from './cleanup';
import {DehydratedContainerView, MULTIPLIER, NUM_ROOT_NODES, SerializedContainerView, TEMPLATE_ID} from './interfaces';
import {siblingAfter} from './node_lookup_utils';


/**
 * Given a current DOM node and a serialized information about the views
 * in a container, walks over the DOM structure, collecting the list of
 * dehydrated views.
 *
 * 给定一个当前 DOM 节点和一个关于容器中视图的序列化信息，遍历 DOM 结构，收集脱水视图列表。
 *
 */
export function locateDehydratedViewsInContainer(
    currentRNode: RNode,
    serializedViews: SerializedContainerView[]): [RNode, DehydratedContainerView[]] {
  const dehydratedViews: DehydratedContainerView[] = [];
  for (const serializedView of serializedViews) {
    // Repeats a view multiple times as needed, based on the serialized information
    // (for example, for *ngFor-produced views).
    for (let i = 0; i < (serializedView[MULTIPLIER] ?? 1); i++) {
      const view: DehydratedContainerView = {
        data: serializedView,
        firstChild: null,
      };
      if (serializedView[NUM_ROOT_NODES] > 0) {
        // Keep reference to the first node in this view,
        // so it can be accessed while invoking template instructions.
        view.firstChild = currentRNode as HTMLElement;

        // Move over to the next node after this view, which can
        // either be a first node of the next view or an anchor comment
        // node after the last view in a container.
        currentRNode = siblingAfter(serializedView[NUM_ROOT_NODES], currentRNode)!;
      }
      dehydratedViews.push(view);
    }
  }

  return [currentRNode, dehydratedViews];
}

/**
 * Reference to a function that searches for a matching dehydrated views
 * stored on a given lContainer.
 * Returns `null` by default, when hydration is not enabled.
 *
 * 对搜索存储在给定 lContainer 上的匹配脱水视图的函数的引用。未启用水合时，默认返回 `null`。
 *
 */
let _findMatchingDehydratedViewImpl: typeof findMatchingDehydratedViewImpl =
    (lContainer: LContainer, template: string|null) => null;

/**
 * Retrieves the next dehydrated view from the LContainer and verifies that
 * it matches a given template id \(from the TView that was used to create this
 * instance of a view\). If the id doesn't match, that means that we are in an
 * unexpected state and can not complete the reconciliation process. Thus,
 * all dehydrated views from this LContainer are removed \(including corresponding
 * DOM nodes\) and the rendering is performed as if there were no dehydrated views
 * in this container.
 *
 * 从 LContainer 中检索下一个脱水视图并验证它是否与给定的模板 ID 匹配（来自用于创建此视图实例的 TView）。如果 id 不匹配，则意味着我们处于意外状态，无法完成对帐过程。因此，此 LContainer 中的所有脱水视图都将被删除（包括相应的 DOM 节点），并且执行渲染时就好像此容器中没有脱水视图一样。
 *
 */
function findMatchingDehydratedViewImpl(
    lContainer: LContainer, template: string|null): DehydratedContainerView|null {
  const views = lContainer[DEHYDRATED_VIEWS] ?? [];
  if (!template || views.length === 0) {
    return null;
  }
  const view = views[0];
  // Verify whether the first dehydrated view in the container matches
  // the template id passed to this function (that originated from a TView
  // that was used to create an instance of an embedded or component views.
  if (view.data[TEMPLATE_ID] === template) {
    // If the template id matches - extract the first view and return it.
    return views.shift()!;
  } else {
    // Otherwise, we are at the state when reconciliation can not be completed,
    // thus we remove all dehydrated views within this container (remove them
    // from internal data structures as well as delete associated elements from
    // the DOM tree).
    removeDehydratedViews(lContainer);
    return null;
  }
}

export function enableFindMatchingDehydratedViewImpl() {
  _findMatchingDehydratedViewImpl = findMatchingDehydratedViewImpl;
}

export function findMatchingDehydratedView(
    lContainer: LContainer, template: string|null): DehydratedContainerView|null {
  return _findMatchingDehydratedViewImpl(lContainer, template);
}