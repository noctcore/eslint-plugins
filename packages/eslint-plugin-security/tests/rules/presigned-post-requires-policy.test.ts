import { ruleTester } from '@noctcore/eslint-test-utils';

import { presignedPostRequiresPolicyRule } from '../../src/rules/presigned-post-requires-policy';

const TS = 'storage.service.ts';
const POLICY = `['content-length-range', 1, MAX_FILE_SIZE], ['eq', '$Content-Type', contentType]`;

ruleTester.run('presigned-post-requires-policy', presignedPostRequiresPolicyRule, {
  valid: [
    // The shape a NestJS storage service uses.
    {
      code: `import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
class StorageService {
  async createUploadPost(key: string, contentType: string, expiresIn = 300) {
    return createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_FILE_SIZE],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: expiresIn,
    });
  }
}`,
      filename: TS,
    },
    // Extra conditions are fine; order does not matter.
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [['eq', '$Content-Type', t], ['starts-with', '$key', 'avatars/'], ['content-length-range', 1, 10]] });`,
      filename: TS,
    },
    // Called off a namespace import.
    { code: `presigner.createPresignedPost(s3, { Bucket, Key, Conditions: [${POLICY}] });`, filename: TS },
    // A typed conditions array.
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [${POLICY}] as Conditions[] });`,
      filename: TS,
    },
    // Not the presigner.
    { code: `createPresignedUrl(s3, { Bucket, Key });`, filename: TS },
    { code: `getSignedUrl(s3, command, { expiresIn: 60 });`, filename: TS },
  ],
  invalid: [
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [['eq', '$Content-Type', t]] });`,
      filename: TS,
      errors: [{ messageId: 'missingLengthRange' }],
    },
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [['content-length-range', 1, 10]] });`,
      filename: TS,
      errors: [{ messageId: 'missingContentType' }],
    },
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [] });`,
      filename: TS,
      errors: [{ messageId: 'missingLengthRange' }, { messageId: 'missingContentType' }],
    },
    // No Conditions at all: the default policy pins nothing.
    {
      code: `createPresignedPost(s3, { Bucket, Key, Fields: { 'Content-Type': t } });`,
      filename: TS,
      errors: [{ messageId: 'optionsNotLiteral' }],
    },
    // No options at all.
    {
      code: `createPresignedPost(s3);`,
      filename: TS,
      errors: [{ messageId: 'optionsNotLiteral' }],
    },
    // A policy built elsewhere is refused rather than followed.
    {
      code: `createPresignedPost(s3, options);`,
      filename: TS,
      errors: [{ messageId: 'optionsNotLiteral' }],
    },
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: conditions });`,
      filename: TS,
      errors: [{ messageId: 'optionsNotLiteral' }],
    },
    // A Content-Type condition that pins nothing (a prefix match on '') is not the eq tuple.
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [['content-length-range', 1, 10], ['starts-with', '$Content-Type', '']] });`,
      filename: TS,
      errors: [{ messageId: 'missingContentType' }],
    },
    // The range tuple must be whole.
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [['content-length-range', 1], ['eq', '$Content-Type', t]] });`,
      filename: TS,
      errors: [{ messageId: 'missingLengthRange' }],
    },
    // Hidden behind a spread, the tuples are not visible at the call.
    {
      code: `createPresignedPost(s3, { Bucket, Key, Conditions: [...policy] });`,
      filename: TS,
      errors: [{ messageId: 'missingLengthRange' }, { messageId: 'missingContentType' }],
    },
  ],
});
