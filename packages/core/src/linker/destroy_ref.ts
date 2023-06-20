/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {EnvironmentInjector} from '../di';
import {LView} from '../render3/interfaces/view';
import {getLView} from '../render3/state';
import {removeLViewOnDestroy, storeLViewOnDestroy} from '../render3/util/view_utils';

/**
 * `DestroyRef` lets you set callbacks to run for any cleanup or destruction behavior.
 * The scope of this destruction depends on where `DestroyRef` is injected. If `DestroyRef`
 * is injected in a component or directive, the callbacks run when that component or
 * directive is destroyed. Otherwise the callbacks run when a corresponding injector is destroyed.
 *
 * `DestroyRef` 允许你设置回调以针对任何清理或销毁行为运行。这种销毁的范围取决于注入 `DestroyRef` 位置。如果将 `DestroyRef` 注入到组件或指令中，则回调会在该组件或指令被销毁时运行。否则回调会在相应的注入器被销毁时运行。
 *
 * @publicApi
 */
export abstract class DestroyRef {
  // Here the `DestroyRef` acts primarily as a DI token. There are (currently) types of objects that
  // can be returned from the injector when asking for this token:
  // - `NodeInjectorDestroyRef` when retrieved from a node injector;
  // - `EnvironmentInjector` when retrieved from an environment injector

  /**
   * Registers a destroy callback in a given lifecycle scope.  Returns a cleanup function that can
   * be invoked to unregister the callback.
   *
   * 在给定的生命周期范围内注册销毁回调。返回一个清理函数，可以调用该函数来注销回调。
   *
   * @usageNotes
   *
   * ### Example
   *
   * ### 范例
   *
   * ```typescript
   * const destroyRef = inject(DestroyRef);
   *
   * // register a destroy callback
   * const unregisterFn = destroyRef.onDestroy(() => doSomethingOnDestroy());
   *
   * // stop the destroy callback from executing if needed
   * unregisterFn();
   * ```
   */
  abstract onDestroy(callback: () => void): () => void;

  /**
   * @internal
   * @nocollapse
   */
  static __NG_ELEMENT_ID__: () => DestroyRef = injectDestroyRef;

  /**
   * @internal
   * @nocollapse
   */
  static __NG_ENV_ID__: (injector: EnvironmentInjector) => DestroyRef = (injector) => injector;
}

class NodeInjectorDestroyRef extends DestroyRef {
  constructor(private _lView: LView) {
    super();
  }

  override onDestroy(callback: () => void): () => void {
    storeLViewOnDestroy(this._lView, callback);
    return () => removeLViewOnDestroy(this._lView, callback);
  }
}

function injectDestroyRef(): DestroyRef {
  return new NodeInjectorDestroyRef(getLView());
}