/** What a transform sees and returns. */
import type { Names, Parsed } from './ast';
import type { Edit } from './edits';

export interface TransformContext {
  readonly p: Parsed;
  /**
   * The lines that carry the sink: the labelled lines of a vulnerable case, or
   * the lines of a safe twin that match its vulnerable twin's labelled lines.
   */
  readonly sinkLines: readonly number[];
  readonly names: Names;
}

export interface Transform {
  /** The tag every variant of this transform carries, as `<file>~<name>`. */
  readonly name: string;
  /** One line for the README and the report: what the rewrite does. */
  readonly summary: string;
  /** The edits that rewrite the case; none when the transform does not apply. */
  readonly plan: (context: TransformContext) => Edit[];
}
