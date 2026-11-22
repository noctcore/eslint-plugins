import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { classChain, stripTypeWrappers, type ClassNode } from '../utils/bullmq';
import { importRef, isImportOf, JOBS_MODULE, NEST_BULLMQ_MODULE, usesJobs } from '../utils/jobs';

const RULE_NAME = 'worker-extends-job-host';

type MessageIds = 'mustExtendJobHost' | 'nestProcessor';

/** The decorator call among `decorators` whose callee is imported as `name` from `module`. */
function findDecorator(
  decorators: readonly TSESTree.Decorator[],
  module: string,
  name: string,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Decorator | undefined {
  return decorators.find(
    (decorator) =>
      decorator.expression.type === AST_NODE_TYPES.CallExpression &&
      isImportOf(decorator.expression.callee, module, name, sourceCode),
  );
}

/*
 * A class decorated with `@Worker(queue)` from `@noctcore/jobs` extends
 * `JobHost`, directly or through a base class this file declares. The runtime
 * refuses such a class at boot, and until then nothing in the types says so:
 * `Worker` returns a plain `ClassDecorator`. A base from another module may
 * extend `JobHost` where the rule cannot see, so it passes; a class with no
 * base, a chain this file declares that never reaches it, and NestJS's
 * `WorkerHost` are reported.
 *
 * In an app that uses `@noctcore/jobs` (the file imports it, or a
 * `package.json` up to the workspace root declares it), a NestJS `@Processor`
 * class, or a class extending `WorkerHost` from `@nestjs/bullmq`, is reported
 * too: it runs outside the jobs runtime.
 */
export const workerExtendsJobHostRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a class decorated with `@Worker(queue)` from `@noctcore/jobs` to extend `JobHost`, and report NestJS `@Processor` / `WorkerHost` workers in apps that use `@noctcore/jobs`.',
    },
    schema: [],
    messages: {
      mustExtendJobHost:
        'A `@Worker` class must extend `JobHost<typeof queue>` and implement `handle(job)`. Without it the jobs runtime refuses the class at boot, and the job gets no context, span, metrics or final-failure hook.',
      nestProcessor:
        'This app uses `@noctcore/jobs`: write this worker as `@Worker(queue) class ... extends JobHost<typeof queue>`. A NestJS `@Processor` runs outside the jobs runtime, with no policy, context, tracing or graceful drain.',
    },
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;
    let jobsApp: boolean | undefined;
    const inJobsApp = (): boolean => (jobsApp ??= usesJobs(context));

    /** Whether the class reaches `JobHost`: true, false, or null when a base from elsewhere may. */
    function reachesJobHost(owner: ClassNode): boolean | null {
      const { classes, complete } = classChain(owner, sourceCode);
      for (const cls of classes) {
        if (isImportOf(cls.superClass, JOBS_MODULE, 'JobHost', sourceCode)) return true;
      }
      if (complete) return false;
      const last = classes.at(-1)?.superClass;
      if (last === null || last === undefined) return false;
      const base = stripTypeWrappers(last);
      if (base.type !== AST_NODE_TYPES.Identifier) return null;
      const ref = importRef(base, sourceCode.getScope(base));
      if (ref?.module === NEST_BULLMQ_MODULE && ref.name === 'WorkerHost') return false;
      return null;
    }

    function check(node: ClassNode): void {
      const worker = findDecorator(node.decorators, JOBS_MODULE, 'Worker', sourceCode);
      if (worker !== undefined) {
        if (reachesJobHost(node) === false) {
          context.report({ node: node.id ?? worker, messageId: 'mustExtendJobHost' });
        }
        return;
      }
      const processor = findDecorator(node.decorators, NEST_BULLMQ_MODULE, 'Processor', sourceCode);
      const host = isImportOf(node.superClass, NEST_BULLMQ_MODULE, 'WorkerHost', sourceCode)
        ? node.superClass
        : null;
      const reportOn = processor ?? host;
      if (reportOn !== null && reportOn !== undefined && inJobsApp()) {
        context.report({ node: reportOn, messageId: 'nestProcessor' });
      }
    }

    return {
      ClassDeclaration: check,
      ClassExpression: check,
    };
  },
});
