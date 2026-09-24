/**
 * `@noctcore/lint-meta-rules/trpc`: cross-tree checks between tRPC routers and
 * the clients that call them.
 *
 * A separate entry point because the rules here pair a server tree with a
 * client tree the project names, and default to the `nestjs-trpc` decorator
 * shape. With no options each is inert, so none belongs in `RULE_FACTORIES` or
 * `createAllRules()`. They load nothing beyond the harness contract.
 */
export {
  createIdempotencyKeyParityRule,
  type IdempotencyKeyParityOptions,
} from './trpc/idempotency-key-parity';
