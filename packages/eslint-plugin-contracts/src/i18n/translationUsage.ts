import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/**
 * Static discovery of translation-key usages, i18next / react-i18next style.
 *
 * The visitor answers one question per call site: "which key, in which
 * namespace(s)?" It never guesses. Every shape it cannot pin down statically
 * (a variable key, a namespace held in a variable it cannot resolve, an opaque
 * options bag) comes back as `dynamic` / `unresolved` so the caller can stay
 * silent on it, the way sibling rules stay silent on spreads.
 *
 * Namespace sources it understands, all by syntax, all per file:
 *   `const { t } = useTranslation('ns', { keyPrefix })`  (also `[t]`, `r.t`, aliases)
 *   `const t = i18n.getFixedT(lng, 'ns', keyPrefix)`
 *   `i18n.t(...)` / `i18next.t(...)`                     (default namespace)
 *   `function f(t: TFunction<'ns'>)`                      (typed parameter)
 *   `import { t } from 'i18next'` or a global `t`         (default namespace)
 *   per call: `t('ns:key')`, `t('key', { ns: 'ns' })`
 *   JSX: `<Trans i18nKey="key" ns="ns" t={t} />`
 * A namespace argument may be a literal, an array of literals, a same-file
 * `const`, a name mapped in `namespaceIdentifiers`, or (under typed linting)
 * any identifier whose type is a single string literal.
 */
export interface TranslationSettings {
  readonly hooks: ReadonlySet<string>;
  readonly instances: ReadonlySet<string>;
  readonly functions: ReadonlySet<string>;
  readonly typeNames: ReadonlySet<string>;
  readonly transComponents: ReadonlySet<string>;
  readonly namespaceIdentifiers: Readonly<Record<string, string>>;
  readonly defaultNamespace: string;
  readonly nsSeparator: string | false;
  readonly keySeparator: string | false;
}

export type TranslationUsage =
  | {
      /** Every key is static: the call is checkable. */
      readonly kind: 'key';
      readonly node: TSESTree.Node;
      /** Namespaces i18next would search, in order. */
      readonly namespaces: readonly string[];
      /** Candidate keys (more than one for `t(['a', 'b'])`); any one resolving is enough. */
      readonly keys: readonly string[];
      readonly plural: boolean;
      readonly context: boolean;
      readonly returnObjects: boolean;
    }
  | {
      /** A template key with a static head: only its prefix is known. */
      readonly kind: 'prefix';
      readonly node: TSESTree.Node;
      readonly namespaces: readonly string[];
      readonly prefix: string;
    }
  | {
      /** The key itself is not static (`t(someVariable)`, `` t(`${x}`) ``). */
      readonly kind: 'dynamic';
      readonly node: TSESTree.Node;
    }
  | {
      /** A translation call whose namespace or options cannot be resolved statically. */
      readonly kind: 'unresolved';
      readonly node: TSESTree.Node;
    };

/** A translation function bound to namespaces (and an optional key prefix). */
interface IBinding {
  readonly namespaces: readonly string[];
  readonly keyPrefix: string | null;
}

/** `null` = not a translation function; `'unresolved'` = one, but its binding is opaque. */
type BindingResult = IBinding | 'unresolved' | null;

const UNRESOLVED = 'unresolved' as const;

/** Bounds alias chains (`const a = t; const b = a;`) and const-of-const lookups. */
const MAX_DEPTH = 8;

type Context = Readonly<TSESLint.RuleContext<string, readonly unknown[]>>;

function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression
  ) {
    current = current.expression;
  }
  return current;
}

/** A string literal or an expression-free template literal. */
function staticString(node: TSESTree.Node): string | null {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.Literal && typeof inner.value === 'string') return inner.value;
  if (inner.type === AST_NODE_TYPES.TemplateLiteral && inner.expressions.length === 0) {
    return inner.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function propertyName(property: TSESTree.Property): string | null {
  if (property.computed) return staticString(property.key);
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  return staticString(property.key);
}

/** The identifier a destructuring target binds (`t`, `t = fallback`). */
function targetIdentifier(node: TSESTree.Node): TSESTree.Identifier | null {
  if (node.type === AST_NODE_TYPES.Identifier) return node;
  if (node.type === AST_NODE_TYPES.AssignmentPattern && node.left.type === AST_NODE_TYPES.Identifier) {
    return node.left;
  }
  return null;
}

interface ICallOptions {
  readonly namespaces: readonly string[] | null;
  readonly plural: boolean;
  readonly context: boolean;
  readonly returnObjects: boolean;
}

export function createTranslationVisitor(
  context: Context,
  settings: TranslationSettings,
  onUsage: (usage: TranslationUsage) => void,
): TSESLint.RuleListener {
  const sourceCode = context.sourceCode;
  const defaultBinding: IBinding = { namespaces: [settings.defaultNamespace], keyPrefix: null };

  function resolveVariable(identifier: TSESTree.Identifier): TSESLint.Scope.Variable | null {
    let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(identifier);
    while (scope !== null) {
      const variable = scope.set.get(identifier.name);
      if (variable !== undefined) return variable;
      scope = scope.upper;
    }
    return null;
  }

  /** Under typed linting, an identifier whose type is one string literal. */
  function typedStringLiteral(node: TSESTree.Node): string | null {
    const services = sourceCode.parserServices;
    const program = services?.program;
    const map = services?.esTreeNodeToTSNodeMap;
    if (!program || !map) return null;
    const type = program.getTypeChecker().getTypeAtLocation(map.get(node));
    return type.isStringLiteral() ? type.value : null;
  }

  /** A namespace-valued expression, or `'unresolved'`. `undefined` = the default namespace. */
  function resolveNamespaces(node: TSESTree.Node | undefined, depth = 0): readonly string[] | typeof UNRESOLVED {
    if (node === undefined) return defaultBinding.namespaces;
    const inner = unwrap(node);
    const literal = staticString(inner);
    if (literal !== null) return [literal];
    if (inner.type === AST_NODE_TYPES.Literal && inner.value === null) return defaultBinding.namespaces;
    if (inner.type === AST_NODE_TYPES.ArrayExpression) {
      const namespaces: string[] = [];
      for (const element of inner.elements) {
        if (element === null || element.type === AST_NODE_TYPES.SpreadElement) return UNRESOLVED;
        const value = staticString(element) ?? resolveIdentifierString(element, depth);
        if (value === null) return UNRESOLVED;
        namespaces.push(value);
      }
      return namespaces.length > 0 ? namespaces : defaultBinding.namespaces;
    }
    if (inner.type === AST_NODE_TYPES.Identifier && inner.name === 'undefined') return defaultBinding.namespaces;
    const value = resolveIdentifierString(inner, depth);
    return value === null ? UNRESOLVED : [value];
  }

  /** `HELP_NS` -> 'help' via the option map, a same-file const, or its literal type. */
  function resolveIdentifierString(node: TSESTree.Node, depth: number): string | null {
    if (node.type !== AST_NODE_TYPES.Identifier || depth > MAX_DEPTH) return null;
    if (Object.hasOwn(settings.namespaceIdentifiers, node.name)) {
      return settings.namespaceIdentifiers[node.name] ?? null;
    }
    const definition = resolveVariable(node)?.defs[0];
    if (
      definition?.type === 'Variable' &&
      definition.parent.kind === 'const' &&
      definition.node.id.type === AST_NODE_TYPES.Identifier &&
      definition.node.init !== null
    ) {
      const init = unwrap(definition.node.init);
      const literal = staticString(init);
      if (literal !== null) return literal;
      const chained = resolveIdentifierString(init, depth + 1);
      if (chained !== null) return chained;
    }
    return typedStringLiteral(node);
  }

  function isHookCall(node: TSESTree.Node): node is TSESTree.CallExpression {
    return (
      node.type === AST_NODE_TYPES.CallExpression &&
      node.callee.type === AST_NODE_TYPES.Identifier &&
      settings.hooks.has(node.callee.name)
    );
  }

  function isInstance(node: TSESTree.Node): boolean {
    return node.type === AST_NODE_TYPES.Identifier && settings.instances.has(node.name);
  }

  /** A static key prefix (`keyPrefix` option / argument); `undefined` means "none given". */
  function staticPrefix(node: TSESTree.Node | undefined): string | null | typeof UNRESOLVED {
    if (node === undefined) return null;
    const inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.Identifier && inner.name === 'undefined') return null;
    if (inner.type === AST_NODE_TYPES.Literal && inner.value === null) return null;
    return staticString(inner) ?? UNRESOLVED;
  }

  /** `useTranslation(ns, { keyPrefix })`. */
  function bindingFromHook(call: TSESTree.CallExpression): BindingResult {
    const [nsArg, optionsArg] = call.arguments;
    const namespaces = resolveNamespaces(nsArg);
    if (namespaces === UNRESOLVED) return UNRESOLVED;
    let keyPrefix: string | null = null;
    if (optionsArg !== undefined) {
      const options = unwrap(optionsArg);
      if (options.type !== AST_NODE_TYPES.ObjectExpression) return UNRESOLVED;
      for (const property of options.properties) {
        if (property.type !== AST_NODE_TYPES.Property) return UNRESOLVED;
        if (propertyName(property) !== 'keyPrefix') continue;
        const prefix = staticPrefix(property.value);
        if (prefix === UNRESOLVED) return UNRESOLVED;
        keyPrefix = prefix;
      }
    }
    return { namespaces, keyPrefix };
  }

  /** `i18n.getFixedT(lng, ns, keyPrefix)`. */
  function bindingFromGetFixedT(call: TSESTree.CallExpression): BindingResult {
    const [, nsArg, prefixArg] = call.arguments;
    const namespaces = resolveNamespaces(nsArg);
    if (namespaces === UNRESOLVED) return UNRESOLVED;
    const keyPrefix = staticPrefix(prefixArg);
    if (keyPrefix === UNRESOLVED) return UNRESOLVED;
    return { namespaces, keyPrefix };
  }

  function isGetFixedT(node: TSESTree.Node): node is TSESTree.CallExpression {
    return (
      node.type === AST_NODE_TYPES.CallExpression &&
      node.callee.type === AST_NODE_TYPES.MemberExpression &&
      !node.callee.computed &&
      node.callee.property.type === AST_NODE_TYPES.Identifier &&
      node.callee.property.name === 'getFixedT' &&
      isInstance(node.callee.object)
    );
  }

  /** The hook call an identifier holds (`const r = useTranslation('ns')`), if any. */
  function hookCallOf(identifier: TSESTree.Identifier): TSESTree.CallExpression | null {
    const definition = resolveVariable(identifier)?.defs[0];
    if (definition?.type !== 'Variable' || definition.node.id.type !== AST_NODE_TYPES.Identifier) return null;
    const init = definition.node.init === null ? null : unwrap(definition.node.init);
    return init !== null && isHookCall(init) ? init : null;
  }

  /** What an expression evaluating to a `t` function is bound to. */
  function bindingOfTSource(object: TSESTree.Node): BindingResult {
    const inner = unwrap(object);
    if (isHookCall(inner)) return bindingFromHook(inner);
    if (inner.type === AST_NODE_TYPES.Identifier) {
      const hook = hookCallOf(inner);
      if (hook !== null) return bindingFromHook(hook);
      if (isInstance(inner)) return defaultBinding;
    }
    return null;
  }

  /** `TFunction<'ns', 'prefix'>` on a parameter. */
  function bindingFromType(annotation: TSESTree.TSTypeAnnotation | undefined): BindingResult {
    const type = annotation?.typeAnnotation;
    if (type?.type !== AST_NODE_TYPES.TSTypeReference) return null;
    const name =
      type.typeName.type === AST_NODE_TYPES.Identifier
        ? type.typeName.name
        : type.typeName.type === AST_NODE_TYPES.TSQualifiedName
          ? type.typeName.right.name
          : null;
    if (name === null || !settings.typeNames.has(name)) return null;
    const [nsType, prefixType] = type.typeArguments?.params ?? [];
    const literalOf = (node: TSESTree.TypeNode): string | null =>
      node.type === AST_NODE_TYPES.TSLiteralType ? staticString(node.literal) : null;
    let namespaces: readonly string[] = defaultBinding.namespaces;
    if (nsType !== undefined) {
      if (nsType.type === AST_NODE_TYPES.TSTupleType) {
        const values = nsType.elementTypes.map(literalOf);
        if (values.length === 0 || values.some((value) => value === null)) return UNRESOLVED;
        namespaces = values as string[];
      } else {
        const value = literalOf(nsType);
        if (value === null) return UNRESOLVED;
        namespaces = [value];
      }
    }
    let keyPrefix: string | null = null;
    if (prefixType !== undefined) {
      keyPrefix = literalOf(prefixType);
      if (keyPrefix === null) return UNRESOLVED;
    }
    return { namespaces, keyPrefix };
  }

  function bindingFromDeclarator(
    declarator: TSESTree.VariableDeclarator,
    name: TSESTree.Identifier,
    depth: number,
  ): BindingResult {
    if (declarator.init === null) return null;
    const init = unwrap(declarator.init);
    const id = declarator.id;
    if (id.type === AST_NODE_TYPES.Identifier) {
      if (isGetFixedT(init)) return bindingFromGetFixedT(init);
      if (
        init.type === AST_NODE_TYPES.MemberExpression &&
        !init.computed &&
        init.property.type === AST_NODE_TYPES.Identifier &&
        init.property.name === 't'
      ) {
        return bindingOfTSource(init.object);
      }
      // `const translate = t;`
      if (init.type === AST_NODE_TYPES.Identifier) return bindingOfIdentifier(init, depth + 1);
      return null;
    }
    if (id.type === AST_NODE_TYPES.ObjectPattern) {
      for (const property of id.properties) {
        if (property.type !== AST_NODE_TYPES.Property || targetIdentifier(property.value) !== name) continue;
        return propertyName(property) === 't' ? bindingOfTSource(init) : null;
      }
      return null;
    }
    if (id.type === AST_NODE_TYPES.ArrayPattern) {
      const first = id.elements[0];
      if (first && targetIdentifier(first) === name && isHookCall(init)) return bindingFromHook(init);
    }
    return null;
  }

  function bindingOfIdentifier(identifier: TSESTree.Identifier, depth = 0): BindingResult {
    if (depth > MAX_DEPTH) return null;
    const variable = resolveVariable(identifier);
    if (variable === null) {
      return settings.functions.has(identifier.name) ? defaultBinding : null;
    }
    const definition = variable.defs[0];
    if (definition === undefined) return null;
    switch (definition.type) {
      case 'ImportBinding': {
        const specifier = definition.node;
        if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) return null;
        const imported =
          specifier.imported.type === AST_NODE_TYPES.Identifier ? specifier.imported.name : specifier.imported.value;
        return settings.functions.has(imported) ? defaultBinding : null;
      }
      case 'Parameter': {
        const name = definition.name;
        if (name.type !== AST_NODE_TYPES.Identifier) return null;
        const typed = bindingFromType(name.typeAnnotation);
        if (typed !== null) return typed;
        // An untyped `t` parameter is almost certainly a translator, but its
        // namespace is whatever the caller passed: count it, never check it.
        return settings.functions.has(name.name) ? UNRESOLVED : null;
      }
      case 'Variable':
        return definition.name.type === AST_NODE_TYPES.Identifier
          ? bindingFromDeclarator(definition.node, definition.name, depth)
          : null;
      default:
        return null;
    }
  }

  function bindingOfCallee(callee: TSESTree.Node): BindingResult {
    if (callee.type === AST_NODE_TYPES.Identifier) return bindingOfIdentifier(callee);
    if (
      callee.type === AST_NODE_TYPES.MemberExpression &&
      !callee.computed &&
      callee.property.type === AST_NODE_TYPES.Identifier &&
      callee.property.name === 't'
    ) {
      return bindingOfTSource(callee.object);
    }
    return null;
  }

  /** Read a `t(key, options)` options object; `'unresolved'` for opaque bags. */
  function readCallOptions(node: TSESTree.Node | undefined): ICallOptions | typeof UNRESOLVED {
    const none: ICallOptions = { namespaces: null, plural: false, context: false, returnObjects: false };
    if (node === undefined) return none;
    const inner = unwrap(node);
    if (inner.type !== AST_NODE_TYPES.ObjectExpression) return UNRESOLVED;
    let namespaces: readonly string[] | null = null;
    let plural = false;
    let context = false;
    let returnObjects = false;
    for (const property of inner.properties) {
      if (property.type !== AST_NODE_TYPES.Property) return UNRESOLVED;
      const name = propertyName(property);
      if (name === null || name === 'keyPrefix') return UNRESOLVED;
      if (name === 'ns') {
        const resolved = resolveNamespaces(property.value);
        if (resolved === UNRESOLVED) return UNRESOLVED;
        namespaces = resolved;
      } else if (name === 'count') {
        plural = true;
      } else if (name === 'context') {
        context = true;
      } else if (name === 'returnObjects') {
        const value = unwrap(property.value);
        returnObjects = !(value.type === AST_NODE_TYPES.Literal && value.value === false);
      }
    }
    return { namespaces, plural, context, returnObjects };
  }

  /**
   * i18next's own key handling: an explicit `ns:` head wins over options, which
   * win over the binding; the binding's `keyPrefix` is prepended to the key.
   */
  function qualify(
    raw: string,
    binding: IBinding,
    optionNamespaces: readonly string[] | null,
  ): { readonly namespaces: readonly string[]; readonly key: string } | null {
    const { nsSeparator, keySeparator } = settings;
    if (nsSeparator !== false && raw.includes(nsSeparator)) {
      // getFixedT prepends the prefix BEFORE the namespace is split off, which
      // makes `ns:` keys under a keyPrefix resolve somewhere unintuitive. Skip.
      if (binding.keyPrefix !== null) return null;
      const [head = '', ...rest] = raw.split(nsSeparator);
      if (head !== '' && rest.length > 0) {
        return { namespaces: [head], key: rest.join(keySeparator === false ? nsSeparator : keySeparator) };
      }
    }
    const namespaces = optionNamespaces ?? binding.namespaces;
    if (binding.keyPrefix === null || binding.keyPrefix === '') return { namespaces, key: raw };
    return { namespaces, key: `${binding.keyPrefix}${keySeparator === false ? '' : keySeparator}${raw}` };
  }

  /** Emit the usage for one key expression under a resolved binding. */
  function emit(
    node: TSESTree.Node,
    keyNode: TSESTree.Node,
    binding: IBinding,
    options: ICallOptions,
  ): void {
    const inner = unwrap(keyNode);
    const raws: string[] = [];
    const single = staticString(inner);
    if (single !== null) {
      raws.push(single);
    } else if (inner.type === AST_NODE_TYPES.ArrayExpression && inner.elements.length > 0) {
      for (const element of inner.elements) {
        const value = element === null || element.type === AST_NODE_TYPES.SpreadElement ? null : staticString(element);
        if (value === null) {
          onUsage({ kind: 'dynamic', node });
          return;
        }
        raws.push(value);
      }
    } else if (inner.type === AST_NODE_TYPES.TemplateLiteral) {
      const head = inner.quasis[0]?.value.cooked ?? '';
      // `` `errors:${code}` `` keeps its namespace with an empty prefix: the
      // whole namespace is reachable, which dead-key analysis needs to know.
      const qualified = head === '' ? null : qualify(head, binding, options.namespaces);
      if (qualified === null) {
        onUsage({ kind: 'dynamic', node });
      } else {
        onUsage({ kind: 'prefix', node, namespaces: qualified.namespaces, prefix: qualified.key });
      }
      return;
    } else {
      onUsage({ kind: 'dynamic', node });
      return;
    }

    let namespaces: readonly string[] | null = null;
    const keys: string[] = [];
    for (const raw of raws) {
      const qualified = qualify(raw, binding, options.namespaces);
      if (qualified === null || raw === '') {
        onUsage({ kind: 'unresolved', node });
        return;
      }
      // Fallback keys that name different namespaces are rare enough to skip.
      if (namespaces !== null && namespaces.join('\0') !== qualified.namespaces.join('\0')) {
        onUsage({ kind: 'unresolved', node });
        return;
      }
      namespaces = qualified.namespaces;
      keys.push(qualified.key);
    }
    onUsage({
      kind: 'key',
      node,
      namespaces: namespaces ?? binding.namespaces,
      keys,
      plural: options.plural,
      context: options.context,
      returnObjects: options.returnObjects,
    });
  }

  function jsxAttributeValue(attribute: TSESTree.JSXAttribute): TSESTree.Node | null {
    const value = attribute.value;
    if (value === null) return null;
    if (value.type === AST_NODE_TYPES.JSXExpressionContainer) {
      return value.expression.type === AST_NODE_TYPES.JSXEmptyExpression ? null : value.expression;
    }
    return value;
  }

  return {
    CallExpression(node): void {
      const binding = bindingOfCallee(node.callee);
      if (binding === null) return;
      const [keyArg, secondArg, thirdArg] = node.arguments;
      if (keyArg === undefined) return;
      if (binding === UNRESOLVED) {
        onUsage({ kind: 'unresolved', node: keyArg });
        return;
      }
      // `t(key, 'default value', options)` is the legacy signature.
      const optionsArg = secondArg !== undefined && staticString(secondArg) !== null ? thirdArg : secondArg;
      const options = readCallOptions(optionsArg);
      if (options === UNRESOLVED) {
        onUsage({ kind: 'unresolved', node: keyArg });
        return;
      }
      emit(keyArg, keyArg, binding, options);
    },
    JSXOpeningElement(node): void {
      if (node.name.type !== AST_NODE_TYPES.JSXIdentifier || !settings.transComponents.has(node.name.name)) return;
      const attributes = new Map<string, TSESTree.JSXAttribute>();
      for (const attribute of node.attributes) {
        if (attribute.type === AST_NODE_TYPES.JSXSpreadAttribute) {
          onUsage({ kind: 'unresolved', node });
          return;
        }
        if (attribute.name.type === AST_NODE_TYPES.JSXIdentifier) attributes.set(attribute.name.name, attribute);
      }
      const keyAttribute = attributes.get('i18nKey');
      const keyNode = keyAttribute === undefined ? null : jsxAttributeValue(keyAttribute);
      if (keyNode === null) return;

      let binding: BindingResult = defaultBinding;
      const tAttribute = attributes.get('t');
      const tNode = tAttribute === undefined ? null : jsxAttributeValue(tAttribute);
      if (tNode !== null) {
        binding = tNode.type === AST_NODE_TYPES.Identifier ? bindingOfIdentifier(tNode) : UNRESOLVED;
      }
      let namespaces: readonly string[] | null = null;
      const nsAttribute = attributes.get('ns');
      const nsNode = nsAttribute === undefined ? null : jsxAttributeValue(nsAttribute);
      if (nsNode !== null) {
        const resolved = resolveNamespaces(nsNode);
        if (resolved === UNRESOLVED) binding = UNRESOLVED;
        else namespaces = resolved;
      }
      if (binding === null || binding === UNRESOLVED) {
        onUsage({ kind: 'unresolved', node: keyNode });
        return;
      }
      emit(keyNode, keyNode, binding, {
        namespaces,
        plural: attributes.has('count'),
        context: attributes.has('context'),
        returnObjects: false,
      });
    },
  };
}
