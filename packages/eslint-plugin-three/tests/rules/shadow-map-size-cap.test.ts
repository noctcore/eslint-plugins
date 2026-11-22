import { ruleTester } from '@noctcore/eslint-test-utils';

import { shadowMapSizeCapRule } from '../../src/rules/shadow-map-size-cap';

ruleTester.run('shadow-map-size-cap', shadowMapSizeCapRule, {
  valid: [
    'light.shadow.mapSize.set(2048, 2048);',
    'light.shadow.mapSize.width = 1024; light.shadow.mapSize.height = 1024;',
    'sun.shadow.mapSize.setScalar(512);',
    // Values the rule cannot read.
    'light.shadow.mapSize.set(size, size);',
    'light.shadow.mapSize.width = quality.shadowSize;',
    // Not a shadow map size.
    'texture.mapSize.set(8192, 8192); renderTarget.setSize(4096, 4096);',
    'light.mapSize.width = 4096;',
    { code: 'const L = () => <directionalLight castShadow shadow-mapSize={[2048, 2048]} />;', filename: 'src/L.tsx' },
    { code: 'const L = () => <directionalLight shadow-mapSize-width={1024} shadow-bias={-0.0001} />;', filename: 'src/L.tsx' },
    // A raised cap.
    { code: 'light.shadow.mapSize.set(4096, 4096);', options: [{ maxMapSize: 4096 }] },
  ],
  invalid: [
    {
      code: 'light.shadow.mapSize.set(4096, 4096);',
      errors: [
        { messageId: 'aboveCap', data: { value: '4096', max: '2048' } },
        { messageId: 'aboveCap', data: { value: '4096', max: '2048' } },
      ],
    },
    { code: 'light.shadow.mapSize.width = 8192;', errors: [{ messageId: 'aboveCap', data: { value: '8192', max: '2048' } }] },
    { code: 'this.sun.shadow.mapSize.setScalar(4096);', errors: [{ messageId: 'aboveCap' }] },
    {
      code: 'const L = () => <directionalLight castShadow shadow-mapSize={[4096, 4096]} />;',
      filename: 'src/L.tsx',
      errors: [{ messageId: 'aboveCap' }, { messageId: 'aboveCap' }],
    },
    {
      code: 'const L = () => <spotLight shadow-mapSize-height={4096} />;',
      filename: 'src/L.tsx',
      errors: [{ messageId: 'aboveCap' }],
    },
    {
      code: 'light.shadow.mapSize.set(2048, 2048);',
      options: [{ maxMapSize: 1024 }],
      errors: [{ messageId: 'aboveCap' }, { messageId: 'aboveCap' }],
    },
  ],
});
