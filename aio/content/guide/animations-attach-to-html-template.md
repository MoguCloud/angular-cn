# Define animations and attach to an HTML template

# 定义动画并附加到 HTML 模板

Animations are defined in the metadata of the component that controls the HTML element to be animated.

动画是在控制要动画的 HTML 元素的宿主组件的元数据中定义的。

## Define the animation

## 定义动画。

Put the code that defines your animations under the `animations:` property within the `@Component()` decorator.

将定义动画的代码放在 `@Component()` 装饰器中的 `animations:` 属性下。

<code-example header="src/app/open-close.component.ts" path="animations/src/app/open-close.component.ts" region="component"></code-example>

When an animation trigger for a component is defined, attach it to an element in the template. Wrap the trigger name in brackets and precede it with an `@` symbol.
Bind the trigger to a template expression using standard Angular property binding syntax. The `triggerName` is the name of the trigger, and `expression` evaluates to a defined animation state.

定义了组件的动画触发器后，将其附加到模板中的元素。将触发器名称括在方括号中，并在它前面加上 `@` 符号。可以使用标准的 Angular 属性绑定语法将触发器绑定到模板表达式。其中 `triggerName` 是触发器的名称，`expression` 计算为某个已定义的动画状态。

<code-example format="typescript" language="typescript">

&lt;div [&commat;triggerName]="expression"&gt;&hellip;&lt;/div&gt;;

</code-example>

The animation is executed or triggered when the expression value changes to a new state.

当该表达式的值变成了新的状态时，动画就会执行或者叫触发。

The following code snippet binds the trigger to the value of the `isOpen` property.

下列代码片段把该触发器绑定到了 `isOpen` 属性的值上。

<code-example header="src/app/open-close.component.html" path="animations/src/app/open-close.component.1.html" region="trigger"></code-example>

In this example, when the `isOpen` expression evaluates to a defined state of `open` or `closed`, it notifies the trigger `openClose` of a state change.
Then it's up to the `openClose` code to handle the state change and kick off a state change animation.

在这个例子中，当 `isOpen` 表达式求值为一个已定义状态 `open` 或 `closed` 时，就会通知 `openClose` 触发器说状态变化了。然后，就由 `openClose` 中的代码来处理状态变更，并启动状态变更动画。

For elements entering or leaving a page \(inserted or removed from the DOM\), you can make the animations conditional.
For example, use `*ngIf` with the animation trigger in the HTML template.

对于那些进入或离开页面的元素（插入到 DOM 中或从中移除），你可以让动画变成有条件的。比如，在 HTML 模板中可以和 `*ngIf` 一起使用动画触发器。

<div class="alert is-helpful">

**NOTE**: <br />
In the component file, set the trigger that defines the animations as the value of the `animations:` property in the `@Component()` decorator.

注意：<br />
在组件文件中，将定义动画的触发器设置为 `@Component()` 装饰器中 `animations:` 属性的值。

## Attach an animation to an HTML template

## 将动画附加到 HTML 模板

In the HTML template file, use the trigger name to attach the defined animations to the HTML element to be animated.

在 HTML 模板文件中，使用触发器名称把已定义的动画附着到要执行动画的 HTML 元素上。

</div>

@reviewed 2022-10-28
