/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DEFAULT_INTERPOLATION_CONFIG, InterpolationConfig, LexerRange, ParsedTemplate, ParseSourceFile, parseTemplate, TmplAstNode} from '@angular/compiler';
import ts from 'typescript';

import {ErrorCode, FatalDiagnosticError} from '../../../diagnostics';
import {absoluteFrom} from '../../../file_system';
import {DependencyTracker} from '../../../incremental/api';
import {Resource} from '../../../metadata';
import {PartialEvaluator} from '../../../partial_evaluator';
import {ClassDeclaration, DeclarationNode, Decorator} from '../../../reflection';
import {TemplateSourceMapping} from '../../../typecheck/api';
import {createValueHasWrongTypeError, isStringArray, ResourceLoader} from '../../common';

/**
 * The literal style url extracted from the decorator, along with metadata for diagnostics.
 *
 * 从装饰器中提取的文字风格 url，以及用于诊断的元数据。
 *
 */
export interface StyleUrlMeta {
  url: string;
  nodeForError: ts.Node;
  source: ResourceTypeForDiagnostics.StylesheetFromTemplate|
      ResourceTypeForDiagnostics.StylesheetFromDecorator;
}

/**
 * Information about the origin of a resource in the application code. This is used for creating
 * diagnostics, so we can point to the root cause of an error in the application code.
 *
 * 应用程序代码中有关资源来源的信息。这用于创建诊断，因此我们可以指出应用程序代码中错误的根本原因。
 *
 * A template resource comes from the `templateUrl` property on the component decorator.
 *
 * 模板资源来自组件装饰器上的 `templateUrl` 属性。
 *
 * Stylesheets resources can come from either the `styleUrls` property on the component decorator,
 * or from inline `style` tags and style links on the external template.
 *
 * 样式表资源可以来自组件装饰器上的 `styleUrls` 属性，也可以来自外部模板上的内联 `style`
 * 标签和样式链接。
 *
 */
export const enum ResourceTypeForDiagnostics {
  Template,
  StylesheetFromTemplate,
  StylesheetFromDecorator,
}


/**
 * Information about the template which was extracted during parsing.
 *
 * 有关解析期间提取的模板的信息。
 *
 * This contains the actual parsed template as well as any metadata collected during its parsing,
 * some of which might be useful for re-parsing the template with different options.
 *
 * 这包含实际解析的模板以及在其解析期间收集的任何元数据，其中一些可能可用于使用不同的选项重新解析模板。
 *
 */
export interface ParsedComponentTemplate extends ParsedTemplate {
  /**
   * The template AST, parsed in a manner which preserves source map information for diagnostics.
   *
   * 模板 AST，以保留源映射信息以进行诊断的方式解析。
   *
   * Not useful for emit.
   *
   * 对发射没有用。
   *
   */
  diagNodes: TmplAstNode[];

  /**
   * The `ParseSourceFile` for the template.
   *
   * 模板的 `ParseSourceFile` 。
   *
   */
  file: ParseSourceFile;
}

export interface ParsedTemplateWithSource extends ParsedComponentTemplate {
  /**
   * The string contents of the template.
   *
   * 模板的字符串内容。
   *
   */
  content: string;
  sourceMapping: TemplateSourceMapping;
  declaration: TemplateDeclaration;
}



/**
 * Common fields extracted from the declaration of a template.
 *
 * 从模板声明中提取的通用字段。
 *
 */
interface CommonTemplateDeclaration {
  preserveWhitespaces: boolean;
  interpolationConfig: InterpolationConfig;
  templateUrl: string;
  resolvedTemplateUrl: string;
}

/**
 * Information extracted from the declaration of an inline template.
 *
 * 从内联模板声明中提取的信息。
 *
 */
export interface InlineTemplateDeclaration extends CommonTemplateDeclaration {
  isInline: true;
  expression: ts.Expression;
}

/**
 * Information extracted from the declaration of an external template.
 *
 * 从外部模板的声明中提取的信息。
 *
 */
export interface ExternalTemplateDeclaration extends CommonTemplateDeclaration {
  isInline: false;
  templateUrlExpression: ts.Expression;
}

/**
 * The declaration of a template extracted from a component decorator.
 *
 * 从组件装饰器中提取的模板的声明。
 *
 * This data is extracted and stored separately to facilitate re-interpreting the template
 * declaration whenever the compiler is notified of a change to a template file. With this
 * information, `ComponentDecoratorHandler` is able to re-read the template and update the component
 * record without needing to parse the original decorator again.
 *
 * 这些数据会被单独提取和存储，以方便每当编译器被通知模板文件发生更改时重新解释模板声明。使用这些信息，
 * `ComponentDecoratorHandler` 可以重新读取模板并更新组件记录，而无需再次解析原始装饰器。
 *
 */
export type TemplateDeclaration = InlineTemplateDeclaration|ExternalTemplateDeclaration;

/**
 * Determines the node to use for debugging purposes for the given TemplateDeclaration.
 *
 * 确定要用于给定 TemplateDeclaration 的调试目的的节点。
 *
 */
export function getTemplateDeclarationNodeForError(declaration: TemplateDeclaration): ts.Node {
  // TODO(zarend): Change this to if/else when that is compatible with g3. This uses a switch
  // because if/else fails to compile on g3. That is because g3 compiles this in non-strict mode
  // where type inference does not work correctly.
  switch (declaration.isInline) {
    case true:
      return declaration.expression;
    case false:
      return declaration.templateUrlExpression;
  }
}

export interface ExtractTemplateOptions {
  usePoisonedData: boolean;
  enableI18nLegacyMessageIdFormat: boolean;
  i18nNormalizeLineEndingsInICUs: boolean;
}

export function extractTemplate(
    node: ClassDeclaration, template: TemplateDeclaration, evaluator: PartialEvaluator,
    depTracker: DependencyTracker|null, resourceLoader: ResourceLoader,
    options: ExtractTemplateOptions): ParsedTemplateWithSource {
  if (template.isInline) {
    let sourceStr: string;
    let sourceParseRange: LexerRange|null = null;
    let templateContent: string;
    let sourceMapping: TemplateSourceMapping;
    let escapedString = false;
    let sourceMapUrl: string|null;
    // We only support SourceMaps for inline templates that are simple string literals.
    if (ts.isStringLiteral(template.expression) ||
        ts.isNoSubstitutionTemplateLiteral(template.expression)) {
      // the start and end of the `templateExpr` node includes the quotation marks, which we must
      // strip
      sourceParseRange = getTemplateRange(template.expression);
      sourceStr = template.expression.getSourceFile().text;
      templateContent = template.expression.text;
      escapedString = true;
      sourceMapping = {
        type: 'direct',
        node: template.expression,
      };
      sourceMapUrl = template.resolvedTemplateUrl;
    } else {
      const resolvedTemplate = evaluator.evaluate(template.expression);
      if (typeof resolvedTemplate !== 'string') {
        throw createValueHasWrongTypeError(
            template.expression, resolvedTemplate, 'template must be a string');
      }
      // We do not parse the template directly from the source file using a lexer range, so
      // the template source and content are set to the statically resolved template.
      sourceStr = resolvedTemplate;
      templateContent = resolvedTemplate;
      sourceMapping = {
        type: 'indirect',
        node: template.expression,
        componentClass: node,
        template: templateContent,
      };

      // Indirect templates cannot be mapped to a particular byte range of any input file, since
      // they're computed by expressions that may span many files. Don't attempt to map them back
      // to a given file.
      sourceMapUrl = null;
    }

    return {
      ...parseExtractedTemplate(
          template, sourceStr, sourceParseRange, escapedString, sourceMapUrl, options),
      content: templateContent,
      sourceMapping,
      declaration: template,
    };
  } else {
    const templateContent = resourceLoader.load(template.resolvedTemplateUrl);
    if (depTracker !== null) {
      depTracker.addResourceDependency(
          node.getSourceFile(), absoluteFrom(template.resolvedTemplateUrl));
    }

    return {
      ...parseExtractedTemplate(
          template, /* sourceStr */ templateContent, /* sourceParseRange */ null,
          /* escapedString */ false,
          /* sourceMapUrl */ template.resolvedTemplateUrl, options),
      content: templateContent,
      sourceMapping: {
        type: 'external',
        componentClass: node,
        // TODO(alxhub): TS in g3 is unable to make this inference on its own, so cast it here
        // until g3 is able to figure this out.
        node: (template as ExternalTemplateDeclaration).templateUrlExpression,
        template: templateContent,
        templateUrl: template.resolvedTemplateUrl,
      },
      declaration: template,
    };
  }
}

function parseExtractedTemplate(
    template: TemplateDeclaration, sourceStr: string, sourceParseRange: LexerRange|null,
    escapedString: boolean, sourceMapUrl: string|null,
    options: ExtractTemplateOptions): ParsedComponentTemplate {
  // We always normalize line endings if the template has been escaped (i.e. is inline).
  const i18nNormalizeLineEndingsInICUs = escapedString || options.i18nNormalizeLineEndingsInICUs;

  const parsedTemplate = parseTemplate(sourceStr, sourceMapUrl ?? '', {
    preserveWhitespaces: template.preserveWhitespaces,
    interpolationConfig: template.interpolationConfig,
    range: sourceParseRange ?? undefined,
    escapedString,
    enableI18nLegacyMessageIdFormat: options.enableI18nLegacyMessageIdFormat,
    i18nNormalizeLineEndingsInICUs,
    alwaysAttemptHtmlToR3AstConversion: options.usePoisonedData,
  });

  // Unfortunately, the primary parse of the template above may not contain accurate source map
  // information. If used directly, it would result in incorrect code locations in template
  // errors, etc. There are three main problems:
  //
  // 1. `preserveWhitespaces: false` annihilates the correctness of template source mapping, as
  //    the whitespace transformation changes the contents of HTML text nodes before they're
  //    parsed into Angular expressions.
  // 2. `preserveLineEndings: false` causes growing misalignments in templates that use '\r\n'
  //    line endings, by normalizing them to '\n'.
  // 3. By default, the template parser strips leading trivia characters (like spaces, tabs, and
  //    newlines). This also destroys source mapping information.
  //
  // In order to guarantee the correctness of diagnostics, templates are parsed a second time
  // with the above options set to preserve source mappings.

  const {nodes: diagNodes} = parseTemplate(sourceStr, sourceMapUrl ?? '', {
    preserveWhitespaces: true,
    preserveLineEndings: true,
    interpolationConfig: template.interpolationConfig,
    range: sourceParseRange ?? undefined,
    escapedString,
    enableI18nLegacyMessageIdFormat: options.enableI18nLegacyMessageIdFormat,
    i18nNormalizeLineEndingsInICUs,
    leadingTriviaChars: [],
    alwaysAttemptHtmlToR3AstConversion: options.usePoisonedData,
  });

  return {
    ...parsedTemplate,
    diagNodes,
    file: new ParseSourceFile(sourceStr, sourceMapUrl ?? ''),
  };
}

export function parseTemplateDeclaration(
    decorator: Decorator, component: Map<string, ts.Expression>, containingFile: string,
    evaluator: PartialEvaluator, resourceLoader: ResourceLoader,
    defaultPreserveWhitespaces: boolean): TemplateDeclaration {
  let preserveWhitespaces: boolean = defaultPreserveWhitespaces;
  if (component.has('preserveWhitespaces')) {
    const expr = component.get('preserveWhitespaces')!;
    const value = evaluator.evaluate(expr);
    if (typeof value !== 'boolean') {
      throw createValueHasWrongTypeError(expr, value, 'preserveWhitespaces must be a boolean');
    }
    preserveWhitespaces = value;
  }

  let interpolationConfig = DEFAULT_INTERPOLATION_CONFIG;
  if (component.has('interpolation')) {
    const expr = component.get('interpolation')!;
    const value = evaluator.evaluate(expr);
    if (!Array.isArray(value) || value.length !== 2 ||
        !value.every(element => typeof element === 'string')) {
      throw createValueHasWrongTypeError(
          expr, value, 'interpolation must be an array with 2 elements of string type');
    }
    interpolationConfig = InterpolationConfig.fromArray(value as [string, string]);
  }

  if (component.has('templateUrl')) {
    const templateUrlExpr = component.get('templateUrl')!;
    const templateUrl = evaluator.evaluate(templateUrlExpr);
    if (typeof templateUrl !== 'string') {
      throw createValueHasWrongTypeError(
          templateUrlExpr, templateUrl, 'templateUrl must be a string');
    }
    try {
      const resourceUrl = resourceLoader.resolve(templateUrl, containingFile);
      return {
        isInline: false,
        interpolationConfig,
        preserveWhitespaces,
        templateUrl,
        templateUrlExpression: templateUrlExpr,
        resolvedTemplateUrl: resourceUrl,
      };
    } catch (e) {
      throw makeResourceNotFoundError(
          templateUrl, templateUrlExpr, ResourceTypeForDiagnostics.Template);
    }
  } else if (component.has('template')) {
    return {
      isInline: true,
      interpolationConfig,
      preserveWhitespaces,
      expression: component.get('template')!,
      templateUrl: containingFile,
      resolvedTemplateUrl: containingFile,
    };
  } else {
    throw new FatalDiagnosticError(
        ErrorCode.COMPONENT_MISSING_TEMPLATE, Decorator.nodeForError(decorator),
        'component is missing a template');
  }
}

export function preloadAndParseTemplate(
    evaluator: PartialEvaluator, resourceLoader: ResourceLoader, depTracker: DependencyTracker|null,
    preanalyzeTemplateCache: Map<DeclarationNode, ParsedTemplateWithSource>, node: ClassDeclaration,
    decorator: Decorator, component: Map<string, ts.Expression>, containingFile: string,
    defaultPreserveWhitespaces: boolean,
    options: ExtractTemplateOptions): Promise<ParsedTemplateWithSource|null> {
  if (component.has('templateUrl')) {
    // Extract the templateUrl and preload it.
    const templateUrlExpr = component.get('templateUrl')!;
    const templateUrl = evaluator.evaluate(templateUrlExpr);
    if (typeof templateUrl !== 'string') {
      throw createValueHasWrongTypeError(
          templateUrlExpr, templateUrl, 'templateUrl must be a string');
    }
    try {
      const resourceUrl = resourceLoader.resolve(templateUrl, containingFile);
      const templatePromise =
          resourceLoader.preload(resourceUrl, {type: 'template', containingFile});

      // If the preload worked, then actually load and parse the template, and wait for any
      // style URLs to resolve.
      if (templatePromise !== undefined) {
        return templatePromise.then(() => {
          const templateDecl = parseTemplateDeclaration(
              decorator, component, containingFile, evaluator, resourceLoader,
              defaultPreserveWhitespaces);
          const template =
              extractTemplate(node, templateDecl, evaluator, depTracker, resourceLoader, options);
          preanalyzeTemplateCache.set(node, template);
          return template;
        });
      } else {
        return Promise.resolve(null);
      }
    } catch (e) {
      throw makeResourceNotFoundError(
          templateUrl, templateUrlExpr, ResourceTypeForDiagnostics.Template);
    }
  } else {
    const templateDecl = parseTemplateDeclaration(
        decorator, component, containingFile, evaluator, resourceLoader,
        defaultPreserveWhitespaces);
    const template =
        extractTemplate(node, templateDecl, evaluator, depTracker, resourceLoader, options);
    preanalyzeTemplateCache.set(node, template);
    return Promise.resolve(template);
  }
}

function getTemplateRange(templateExpr: ts.Expression) {
  const startPos = templateExpr.getStart() + 1;
  const {line, character} =
      ts.getLineAndCharacterOfPosition(templateExpr.getSourceFile(), startPos);
  return {
    startPos,
    startLine: line,
    startCol: character,
    endPos: templateExpr.getEnd() - 1,
  };
}

export function makeResourceNotFoundError(
    file: string, nodeForError: ts.Node,
    resourceType: ResourceTypeForDiagnostics): FatalDiagnosticError {
  let errorText: string;
  switch (resourceType) {
    case ResourceTypeForDiagnostics.Template:
      errorText = `Could not find template file '${file}'.`;
      break;
    case ResourceTypeForDiagnostics.StylesheetFromTemplate:
      errorText = `Could not find stylesheet file '${file}' linked from the template.`;
      break;
    case ResourceTypeForDiagnostics.StylesheetFromDecorator:
      errorText = `Could not find stylesheet file '${file}'.`;
      break;
  }

  return new FatalDiagnosticError(ErrorCode.COMPONENT_RESOURCE_NOT_FOUND, nodeForError, errorText);
}


/**
 * Transforms the given decorator to inline external resources. i.e. if the decorator
 * resolves to `@Component`, the `templateUrl` and `styleUrls` metadata fields will be
 * transformed to their semantically-equivalent inline variants.
 *
 * 将给定的装饰器转换为内联外部资源。即，如果装饰器解析为 `@Component` ，则 `templateUrl` 和
 * `styleUrls` 元数据字段将被转换为它们在语义上等效的内联变体。
 *
 * This method is used for serializing decorators into the class metadata. The emitted
 * class metadata should not refer to external resources as this would be inconsistent
 * with the component definitions/declarations which already inline external resources.
 *
 * 此方法用于将装饰器序列化为类元数据。发出的类元数据不应引用外部资源，因为这将与已经内联外部资源的组件定义/声明不一致。
 *
 * Additionally, the references to external resources would require libraries to ship
 * external resources exclusively for the class metadata.
 *
 * 此外，对外部资源的引用将要求库专门为类元数据提供外部资源。
 *
 */
export function transformDecoratorResources(
    dec: Decorator, component: Map<string, ts.Expression>, styles: string[],
    template: ParsedTemplateWithSource): Decorator {
  if (dec.name !== 'Component') {
    return dec;
  }

  // If no external resources are referenced, preserve the original decorator
  // for the best source map experience when the decorator is emitted in TS.
  if (!component.has('templateUrl') && !component.has('styleUrls') && !component.has('styles')) {
    return dec;
  }

  const metadata = new Map(component);

  // Set the `template` property if the `templateUrl` property is set.
  if (metadata.has('templateUrl')) {
    metadata.delete('templateUrl');
    metadata.set('template', ts.factory.createStringLiteral(template.content));
  }

  if (metadata.has('styleUrls') || metadata.has('styles')) {
    metadata.delete('styles');
    metadata.delete('styleUrls');

    if (styles.length > 0) {
      const styleNodes = styles.reduce((result, style) => {
        if (style.trim().length > 0) {
          result.push(ts.factory.createStringLiteral(style));
        }
        return result;
      }, [] as ts.StringLiteral[]);

      if (styleNodes.length > 0) {
        metadata.set('styles', ts.factory.createArrayLiteralExpression(styleNodes));
      }
    }
  }

  // Convert the metadata to TypeScript AST object literal element nodes.
  const newMetadataFields: ts.ObjectLiteralElementLike[] = [];
  for (const [name, value] of metadata.entries()) {
    newMetadataFields.push(ts.factory.createPropertyAssignment(name, value));
  }

  // Return the original decorator with the overridden metadata argument.
  return {...dec, args: [ts.factory.createObjectLiteralExpression(newMetadataFields)]};
}

export function extractComponentStyleUrls(
    evaluator: PartialEvaluator,
    component: Map<string, ts.Expression>,
    ): StyleUrlMeta[] {
  if (!component.has('styleUrls')) {
    return [];
  }

  return extractStyleUrlsFromExpression(evaluator, component.get('styleUrls')!);
}

function extractStyleUrlsFromExpression(
    evaluator: PartialEvaluator, styleUrlsExpr: ts.Expression): StyleUrlMeta[] {
  const styleUrls: StyleUrlMeta[] = [];

  if (ts.isArrayLiteralExpression(styleUrlsExpr)) {
    for (const styleUrlExpr of styleUrlsExpr.elements) {
      if (ts.isSpreadElement(styleUrlExpr)) {
        styleUrls.push(...extractStyleUrlsFromExpression(evaluator, styleUrlExpr.expression));
      } else {
        const styleUrl = evaluator.evaluate(styleUrlExpr);

        if (typeof styleUrl !== 'string') {
          throw createValueHasWrongTypeError(styleUrlExpr, styleUrl, 'styleUrl must be a string');
        }

        styleUrls.push({
          url: styleUrl,
          source: ResourceTypeForDiagnostics.StylesheetFromDecorator,
          nodeForError: styleUrlExpr,
        });
      }
    }
  } else {
    const evaluatedStyleUrls = evaluator.evaluate(styleUrlsExpr);
    if (!isStringArray(evaluatedStyleUrls)) {
      throw createValueHasWrongTypeError(
          styleUrlsExpr, evaluatedStyleUrls, 'styleUrls must be an array of strings');
    }

    for (const styleUrl of evaluatedStyleUrls) {
      styleUrls.push({
        url: styleUrl,
        source: ResourceTypeForDiagnostics.StylesheetFromDecorator,
        nodeForError: styleUrlsExpr,
      });
    }
  }

  return styleUrls;
}
export function extractStyleResources(
    resourceLoader: ResourceLoader, component: Map<string, ts.Expression>,
    containingFile: string): ReadonlySet<Resource> {
  const styles = new Set<Resource>();
  function stringLiteralElements(array: ts.ArrayLiteralExpression): ts.StringLiteralLike[] {
    return array.elements.filter(
        (e: ts.Expression): e is ts.StringLiteralLike => ts.isStringLiteralLike(e));
  }

  // If styleUrls is a literal array, process each resource url individually and
  // register ones that are string literals.
  const styleUrlsExpr = component.get('styleUrls');
  if (styleUrlsExpr !== undefined && ts.isArrayLiteralExpression(styleUrlsExpr)) {
    for (const expression of stringLiteralElements(styleUrlsExpr)) {
      try {
        const resourceUrl = resourceLoader.resolve(expression.text, containingFile);
        styles.add({path: absoluteFrom(resourceUrl), expression});
      } catch {
        // Errors in style resource extraction do not need to be handled here. We will produce
        // diagnostics for each one that fails in the analysis, after we evaluate the
        // `styleUrls` expression to determine _all_ style resources, not just the string
        // literals.
      }
    }
  }

  const stylesExpr = component.get('styles');
  if (stylesExpr !== undefined && ts.isArrayLiteralExpression(stylesExpr)) {
    for (const expression of stringLiteralElements(stylesExpr)) {
      styles.add({path: null, expression});
    }
  }

  return styles;
}

export function _extractTemplateStyleUrls(template: ParsedTemplateWithSource): StyleUrlMeta[] {
  if (template.styleUrls === null) {
    return [];
  }

  const nodeForError = getTemplateDeclarationNodeForError(template.declaration);
  return template.styleUrls.map(
      url => ({url, source: ResourceTypeForDiagnostics.StylesheetFromTemplate, nodeForError}));
}