import { ruleTester } from '@noctcore/eslint-test-utils';

import { noLlmOutputToSinkRule } from '../../src/rules/no-llm-output-to-sink';

const TS = 'handler.ts';
const TSX = 'Answer.tsx';

/** Wraps statements in an async function, the shape every SDK call lives in. */
const fn = (body: string): string => `async function handler(messages, el) {\n${body}\n}`;

const OPENAI = `const res = await openai.chat.completions.create({ model: 'gpt-4o', messages });`;
const ANTHROPIC = `const msg = await anthropic.messages.create({ model: 'claude-sonnet-5', max_tokens: 1024, messages });`;

const error = (source: string, sink: string) => ({
  messageId: 'llmOutputToSink' as const,
  data: { source, sink },
});
const OPENAI_CHAT = 'an OpenAI chat completion';
const ANTHROPIC_MSG = 'an Anthropic message';

ruleTester.run('no-llm-output-to-sink', noLlmOutputToSinkRule, {
  valid: [
    // textContent is not a sink: the browser never parses it as HTML.
    { code: fn(`${OPENAI}\nel.textContent = res.choices[0].message.content;`), filename: TS },
    // A schema parse ends the chain, even over JSON.parse.
    {
      code: fn(`${OPENAI}\nconst plan = Plan.parse(JSON.parse(res.choices[0].message.content ?? '{}'));\nexec(plan.command);`),
      filename: TS,
    },
    // A sanitizer ends the chain.
    {
      code: fn(`${OPENAI}\nel.innerHTML = DOMPurify.sanitize(res.choices[0].message.content ?? '');`),
      filename: TS,
    },
    // Used as a plain string: logged, returned, stored.
    {
      code: fn(`${OPENAI}\nconst text = res.choices[0].message.content;\nconsole.log(text);\nawait db.note.create({ data: { text } });\nreturn text;`),
      filename: TS,
    },
    // A non-LLM `.content` with no SDK call behind it.
    {
      code: fn(`const page = await cms.pages.get(slug);\nel.innerHTML = page.content[0].text;`),
      filename: TS,
    },
    // `.content` of a plain fetch response is not model output.
    {
      code: fn(`const data = await (await fetch('/api/post')).json();\nel.innerHTML = data.choices[0].message.content;`),
      filename: TS,
    },
    // Not awaited: the chain is not visible.
    {
      code: fn(`const pending = openai.chat.completions.create({ messages });\neval(pending.choices[0].message.content);`),
      filename: TS,
    },
    // A `let` can be reassigned, so it is not followed.
    {
      code: fn(`${OPENAI}\nlet text = res.choices[0].message.content;\ntext = escapeHtml(text);\nel.innerHTML = text;`),
      filename: TS,
    },
    // A parameter is not followed: no cross-function analysis.
    { code: `function render(el, html) { el.innerHTML = html; }`, filename: TS },
    // The response object itself is not the model's text.
    { code: fn(`${OPENAI}\nconsole.log(res.usage.total_tokens);\nel.innerHTML = String(res.usage.total_tokens);`), filename: TS },
    // The OpenAI role, not the content.
    { code: fn(`${OPENAI}\nel.innerHTML = res.choices[0].message.role;`), filename: TS },
    // Anthropic metadata, not a block's text.
    { code: fn(`${ANTHROPIC}\nel.innerHTML = msg.stop_reason;\nel.innerHTML = msg.content[0].type;`), filename: TS },
    // RegExp.prototype.exec with model text is matching, not a shell.
    { code: fn(`${OPENAI}\nconst m = /\\d+/.exec(res.choices[0].message.content ?? '');\npattern.exec(res.choices[0].message.content);`), filename: TS },
    // A local `exec` that is not child_process.
    {
      code: `const exec = (s) => s;\n${fn(`${OPENAI}\nexec(res.choices[0].message.content);`)}`,
      filename: TS,
    },
    // spawn without a shell passes arguments without re-parsing them.
    {
      code: `import { spawn } from 'node:child_process';\n${fn(`${OPENAI}\nspawn('grep', [res.choices[0].message.content ?? '']);`)}`,
      filename: TS,
    },
    // execFile with an argument array and no shell.
    {
      code: `import { execFile } from 'node:child_process';\n${fn(`${OPENAI}\nexecFile('git', ['log', res.choices[0].message.content ?? '']);`)}`,
      filename: TS,
    },
    // Model text as a bound Prisma parameter, not the SQL text.
    {
      code: fn(`${OPENAI}\nawait prisma.$queryRawUnsafe('SELECT * FROM notes WHERE body = $1', res.choices[0].message.content);`),
      filename: TS,
    },
    // The tagged-template form parameterizes every interpolation.
    { code: fn(`${OPENAI}\nawait prisma.$queryRaw\`SELECT * FROM notes WHERE body = \${res.choices[0].message.content}\`;`), filename: TS },
    // Model text in the query of a URL whose origin is fixed.
    {
      code: fn(`${OPENAI}\nconst q = res.choices[0].message.content ?? '';\nawait fetch(\`https://api.example.com/search?q=\${encodeURIComponent(q)}\`);\nawait fetch(\`https://api.example.com/search?q=\${q}\`);`),
      filename: TS,
    },
    // Model text in the body of a request, not its URL.
    {
      code: fn(`${OPENAI}\nawait fetch('https://api.example.com/notes', { method: 'POST', body: res.choices[0].message.content });`),
      filename: TS,
    },
    // A const URL that pins its origin before the model text.
    {
      code: fn(`${OPENAI}\nconst url = 'https://api.example.com/items/' + res.choices[0].message.content;\nawait fetch(url);`),
      filename: TS,
    },
    // Model text written as file contents, not as the path.
    {
      code: `import { writeFile } from 'node:fs/promises';\n${fn(`${OPENAI}\nawait writeFile('out/answer.md', res.choices[0].message.content ?? '');`)}`,
      filename: TS,
    },
    // path.join is a call the rule does not see through.
    {
      code: `import fs from 'node:fs';\n${fn(`${OPENAI}\nfs.readFileSync(path.join(root, 'notes.md'));`)}`,
      filename: TS,
    },
    // generateText imported from somewhere other than the AI SDK.
    {
      code: `import { generateText } from './mock';\n${fn(`const { text } = await generateText({ prompt });\neval(text);`)}`,
      filename: TS,
    },
    // generateText's usage, not its text.
    {
      code: `import { generateText } from 'ai';\n${fn(`const result = await generateText({ model, prompt });\nel.innerHTML = String(result.usage.totalTokens);`)}`,
      filename: TS,
    },
    // A schema-validated generateObject result piped through a sanitizer.
    {
      code: `import { generateObject } from 'ai';\n${fn(`const { object } = await generateObject({ model, schema, prompt });\nel.innerHTML = sanitize(object.html);`)}`,
      filename: TS,
    },
    // Listing messages is not generating one.
    { code: fn(`const list = await client.messages.list();\nel.innerHTML = list.content[0].text;`), filename: TS },
    // A replaced string is no longer followed.
    { code: fn(`${OPENAI}\nel.innerHTML = (res.choices[0].message.content ?? '').replace(/[<>&]/g, '');`), filename: TS },
    // JSX text children are escaped by React.
    {
      code: `async function Answer() {\n${OPENAI}\nreturn <p>{res.choices[0].message.content}</p>;\n}`,
      filename: TSX,
    },
    // dangerouslySetInnerHTML with sanitized model text.
    {
      code: `async function Answer() {\n${OPENAI}\nreturn <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(res.choices[0].message.content ?? '') }} />;\n}`,
      filename: TSX,
    },
    // `messages.create` with no receiver before it is not an SDK call.
    { code: fn(`const m = await messages.create({});\nel.innerHTML = m.content[0].text;`), filename: TS },
    // A tool_use block's `id` and `name` are the SDK's, not model output worth flagging.
    {
      code: fn(`${ANTHROPIC}\nfor (const block of msg.content) {\n  if (block.type === 'tool_use') el.innerHTML = block.name;\n}`),
      filename: TS,
    },
  ],
  invalid: [
    // OpenAI chat completion into eval.
    {
      code: fn(`${OPENAI}\neval(res.choices[0].message.content);`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`eval`')],
    },
    // Optional chaining and `?? ''`, the shape OpenAI's nullable content forces.
    {
      code: fn(`${OPENAI}\nel.innerHTML = res.choices[0]?.message?.content ?? '';`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`innerHTML`')],
    },
    // Through const bindings and destructuring.
    {
      code: fn(`${OPENAI}\nconst [choice] = res.choices;\nconst { message } = choice;\nconst { content: html } = message;\nel.outerHTML = html;`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`outerHTML`')],
    },
    // Destructured straight out of the await.
    {
      code: fn(`const { choices } = await client.chat.completions.create({ messages });\nnew Function(choices[0].message.content)();`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`new Function`')],
    },
    // `.at(0)` picks an element like `[0]`.
    {
      code: fn(`${OPENAI}\ndocument.write(res.choices.at(0).message.content);`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`document.write`')],
    },
    // Concatenated into HTML.
    {
      code: fn(`${OPENAI}\nconst text = res.choices[0].message.content;\nel.innerHTML += '<p>' + text + '</p>';`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`innerHTML`')],
    },
    // insertAdjacentHTML's second argument.
    {
      code: fn(`${OPENAI}\nel.insertAdjacentHTML('beforeend', \`<li>\${res.choices[0].message.content}</li>\`);`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`insertAdjacentHTML`')],
    },
    // OpenAI Responses API output_text.
    {
      code: fn(`const response = await openai.responses.create({ model: 'gpt-5', input });\neval(response.output_text);`),
      filename: TS,
      errors: [error('an OpenAI response', '`eval`')],
    },
    // Anthropic text block.
    {
      code: fn(`${ANTHROPIC}\nel.innerHTML = msg.content[0].text;`),
      filename: TS,
      errors: [error(ANTHROPIC_MSG, '`innerHTML`')],
    },
    // Anthropic block found with `.find(...)`.
    {
      code: fn(`${ANTHROPIC}\nconst block = msg.content.find((b) => b.type === 'text');\nel.innerHTML = block?.text ?? '';`),
      filename: TS,
      errors: [error(ANTHROPIC_MSG, '`innerHTML`')],
    },
    // Anthropic tool_use input into a shell, through for-of.
    {
      code: `import { execSync } from 'node:child_process';\n${fn(`${ANTHROPIC}\nfor (const block of msg.content) {\n  if (block.type === 'tool_use') execSync(block.input.command);\n}`)}`,
      filename: TS,
      errors: [error(ANTHROPIC_MSG, 'the shell command of `execSync`')],
    },
    // A promisified exec from a require.
    {
      code: `const { exec } = require('child_process');\nconst run = util.promisify(exec);\n${fn(`${ANTHROPIC}\nawait run(\`git \${msg.content[0].text}\`);`)}`,
      filename: TS,
      errors: [error(ANTHROPIC_MSG, 'the shell command of `exec`')],
    },
    // A namespace import of child_process.
    {
      code: `import * as cp from 'node:child_process';\n${fn(`${OPENAI}\ncp.exec(res.choices[0].message.content.trim());`)}`,
      filename: TS,
      errors: [error(OPENAI_CHAT, 'the shell command of `exec`')],
    },
    // spawn with shell: true, command and arguments.
    {
      code: `import { spawn } from 'child_process';\n${fn(`${OPENAI}\nconst cmd = res.choices[0].message.content ?? '';\nspawn(cmd, [cmd], { shell: true });`)}`,
      filename: TS,
      errors: [
        error(OPENAI_CHAT, 'the shell command of `spawn`'),
        error(OPENAI_CHAT, 'the shell command of `spawn`'),
      ],
    },
    // Prisma unsafe raw SQL.
    {
      code: fn(`${OPENAI}\nconst sql = res.choices[0].message.content ?? '';\nawait prisma.$queryRawUnsafe(sql);\nawait tx.$executeRawUnsafe(\`DELETE FROM t WHERE \${sql}\`);`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`$queryRawUnsafe`'), error(OPENAI_CHAT, '`$executeRawUnsafe`')],
    },
    // JSX dangerouslySetInnerHTML.
    {
      code: `async function Answer() {\n${OPENAI}\nreturn <div dangerouslySetInnerHTML={{ __html: res.choices[0].message.content ?? '' }} />;\n}`,
      filename: TSX,
      errors: [error(OPENAI_CHAT, '`dangerouslySetInnerHTML`')],
    },
    // The whole fetch URL is model output.
    {
      code: fn(`${OPENAI}\nconst url = res.choices[0].message.content;\nawait fetch(url);`),
      filename: TS,
      errors: [error(OPENAI_CHAT, 'the origin of a `fetch` URL')],
    },
    // Model output in the host position.
    {
      code: fn(`${OPENAI}\nconst host = res.choices[0].message.content;\nawait fetch(\`https://\${host}/api\`);\nawait fetch('https://api.example.com' + host);`),
      filename: TS,
      errors: [
        error(OPENAI_CHAT, 'the origin of a `fetch` URL'),
        error(OPENAI_CHAT, 'the origin of a `fetch` URL'),
      ],
    },
    // fs path, including fs.promises and fs/promises.
    {
      code: `import fs from 'node:fs';\nimport { readFile } from 'fs/promises';\n${fn(`${OPENAI}\nconst name = res.choices[0].message.content;\nfs.readFileSync(\`./notes/\${name}\`);\nawait fs.promises.unlink(name);\nawait readFile(name);`)}`,
      filename: TS,
      errors: [
        error(OPENAI_CHAT, 'a path argument of `fs.readFileSync`'),
        error(OPENAI_CHAT, 'a path argument of `fs.unlink`'),
        error(OPENAI_CHAT, 'a path argument of `fs.readFile`'),
      ],
    },
    // Both paths of a rename.
    {
      code: `import { renameSync } from 'fs';\n${fn(`${ANTHROPIC}\nconst { input } = msg.content[0];\nrenameSync(input.from, input.to);`)}`,
      filename: TS,
      errors: [
        error(ANTHROPIC_MSG, 'a path argument of `fs.renameSync`'),
        error(ANTHROPIC_MSG, 'a path argument of `fs.renameSync`'),
      ],
    },
    // AI SDK generateText, destructured.
    {
      code: `import { generateText } from 'ai';\n${fn(`const { text } = await generateText({ model, prompt });\neval(text);`)}`,
      filename: TS,
      errors: [error('AI SDK `generateText`', '`eval`')],
    },
    // AI SDK generateText through the result object and an alias.
    {
      code: `import { generateText as gen } from 'ai';\n${fn(`const result = await gen({ model, prompt });\nel.innerHTML = result.text;`)}`,
      filename: TS,
      errors: [error('AI SDK `generateText`', '`innerHTML`')],
    },
    // AI SDK generateObject: every field of the object is model output.
    {
      code: `import * as ai from 'ai';\n${fn(`const { object } = await ai.generateObject({ model, schema, prompt });\nawait prisma.$executeRawUnsafe(object.sql);`)}`,
      filename: TS,
      errors: [error('AI SDK `generateObject`', '`$executeRawUnsafe`')],
    },
    // JSON.parse keeps the model's text, now as an object.
    {
      code: `import { exec } from 'node:child_process';\n${fn(`${OPENAI}\nconst args = JSON.parse(res.choices[0].message.content ?? '{}');\nexec(args.command);`)}`,
      filename: TS,
      errors: [error(OPENAI_CHAT, 'the shell command of `exec`')],
    },
    // A closure sees the const it captured.
    {
      code: fn(`${OPENAI}\nconst html = res.choices[0].message.content ?? '';\nbutton.addEventListener('click', () => { el.innerHTML = html; });`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`innerHTML`')],
    },
    // window.eval is eval.
    {
      code: fn(`const r = await this.openai.chat.completions.create({ messages });\nwindow.eval(r.choices[0].message.content as string);`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`eval`')],
    },
    // A filtered array still yields model text.
    {
      code: fn(`${ANTHROPIC}\nconst [first] = msg.content.filter((b) => b.type === 'text');\nel.innerHTML = first.text;`),
      filename: TS,
      errors: [error(ANTHROPIC_MSG, '`innerHTML`')],
    },
    // A conditional still yields model text.
    {
      code: fn(`${OPENAI}\nconst out = res.choices[0].message.content;\nel.innerHTML = out ? out : '<p>empty</p>';`),
      filename: TS,
      errors: [error(OPENAI_CHAT, '`innerHTML`')],
    },
  ],
});
