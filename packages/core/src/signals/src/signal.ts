/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {createSignalFromFunction, defaultEquals, Signal, ValueEqualityFn} from './api';
import {throwInvalidWriteToSignalError} from './errors';
import {ReactiveNode} from './graph';

/**
 * If set, called after `WritableSignal`s are updated.
 *
 * 如果设置，则在 `WritableSignal` 更新后调用。
 *
 * This hook can be used to achieve various effects, such as running effects synchronously as part
 * of setting a signal.
 *
 * 此挂钩可用于实现各种效果，例如作为设置信号的一部分同步运行效果。
 *
 */
let postSignalSetFn: (() => void)|null = null;

/**
 * A `Signal` with a value that can be mutated via a setter interface.
 *
 * 一个 `Signal`，其值可以通过 setter 接口改变。
 *
 * @developerPreview
 */
export interface WritableSignal<T> extends Signal<T> {
  /**
   * Directly set the signal to a new value, and notify any dependents.
   *
   * 直接将信号设置为新值，并通知任何相关人员。
   *
   */
  set(value: T): void;

  /**
   * Update the value of the signal based on its current value, and
   * notify any dependents.
   *
   * 根据信号的当前值更新信号值，并通知任何依赖者。
   *
   */
  update(updateFn: (value: T) => T): void;

  /**
   * Update the current value by mutating it in-place, and
   * notify any dependents.
   *
   * 通过就地改变它来更新当前值，并通知任何依赖者。
   *
   */
  mutate(mutatorFn: (value: T) => void): void;

  /**
   * Returns a readonly version of this signal. Readonly signals can be accessed to read their value
   * but can't be changed using set, update or mutate methods. The readonly signals do _not_ have
   * any built-in mechanism that would prevent deep-mutation of their value.
   *
   * 返回此信号的只读版本。可以访问只读信号以读取它们的值，但不能使用设置、更新或变异方法更改。只读信号 _ 没有 _ 任何内置机制可以防止其值发生深度突变。
   *
   */
  asReadonly(): Signal<T>;
}

class WritableSignalImpl<T> extends ReactiveNode {
  private readonlySignal: Signal<T>|undefined;

  protected override readonly consumerAllowSignalWrites = false;

  constructor(private value: T, private equal: ValueEqualityFn<T>) {
    super();
  }

  protected override onConsumerDependencyMayHaveChanged(): void {
    // This never happens for writable signals as they're not consumers.
  }

  protected override onProducerUpdateValueVersion(): void {
    // Writable signal value versions are always up to date.
  }

  /**
   * Directly update the value of the signal to a new value, which may or may not be
   * equal to the previous.
   *
   * 直接将信号的值更新为一个新值，这个值可能等于也可能不等于之前的值。
   *
   * In the event that `newValue` is semantically equal to the current value, `set` is
   * a no-op.
   *
   * 如果 `newValue` 在语义上等于当前值，`set` 是空操作。
   *
   */
  set(newValue: T): void {
    if (!this.producerUpdatesAllowed) {
      throwInvalidWriteToSignalError();
    }
    if (!this.equal(this.value, newValue)) {
      this.value = newValue;
      this.valueVersion++;
      this.producerMayHaveChanged();

      postSignalSetFn?.();
    }
  }

  /**
   * Derive a new value for the signal from its current value using the `updater` function.
   *
   * 使用 `updater` 函数从信号的当前值导出新值。
   *
   * This is equivalent to calling `set` on the result of running `updater` on the current
   * value.
   *
   * 这相当于对当前值运行 `updater` 的结果调用 `set`。
   *
   */
  update(updater: (value: T) => T): void {
    if (!this.producerUpdatesAllowed) {
      throwInvalidWriteToSignalError();
    }
    this.set(updater(this.value));
  }

  /**
   * Calls `mutator` on the current value and assumes that it has been mutated.
   *
   * 对当前值调用 `mutator` 并假定它已被改变。
   *
   */
  mutate(mutator: (value: T) => void): void {
    if (!this.producerUpdatesAllowed) {
      throwInvalidWriteToSignalError();
    }
    // Mutate bypasses equality checks as it's by definition changing the value.
    mutator(this.value);
    this.valueVersion++;
    this.producerMayHaveChanged();

    postSignalSetFn?.();
  }

  asReadonly(): Signal<T> {
    if (this.readonlySignal === undefined) {
      this.readonlySignal = createSignalFromFunction(this, () => this.signal());
    }
    return this.readonlySignal;
  }

  signal(): T {
    this.producerAccessed();
    return this.value;
  }
}

/**
 * Options passed to the `signal` creation function.
 *
 * 传递给 `signal` 创建函数的选项。
 *
 * @developerPreview
 */
export interface CreateSignalOptions<T> {
  /**
   * A comparison function which defines equality for signal values.
   *
   * 定义信号值相等性的比较函数。
   *
   */
  equal?: ValueEqualityFn<T>;
}

/**
 * Create a `Signal` that can be set or updated directly.
 *
 * 创建一个可以直接设置或更新的 `Signal`。
 *
 * @developerPreview
 */
export function signal<T>(initialValue: T, options?: CreateSignalOptions<T>): WritableSignal<T> {
  const signalNode = new WritableSignalImpl(initialValue, options?.equal ?? defaultEquals);

  // Casting here is required for g3, as TS inference behavior is slightly different between our
  // version/options and g3's.
  const signalFn = createSignalFromFunction(signalNode, signalNode.signal.bind(signalNode), {
                     set: signalNode.set.bind(signalNode),
                     update: signalNode.update.bind(signalNode),
                     mutate: signalNode.mutate.bind(signalNode),
                     asReadonly: signalNode.asReadonly.bind(signalNode)
                   }) as unknown as WritableSignal<T>;
  return signalFn;
}

export function setPostSignalSetFn(fn: (() => void)|null): (() => void)|null {
  const prev = postSignalSetFn;
  postSignalSetFn = fn;
  return prev;
}
