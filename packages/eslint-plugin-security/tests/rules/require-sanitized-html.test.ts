import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireSanitizedHtmlRule } from '../../src/rules/require-sanitized-html';

const TSX = 'component.tsx';
const TS = 'dom.ts';

ruleTester.run('require-sanitized-html', requireSanitizedHtmlRule, {
  valid: [
    // Author-written markup: literals and expression-free templates.
    { code: `<div dangerouslySetInnerHTML={{ __html: '<b>hi</b>' }} />;`, filename: TSX },
    { code: '<div dangerouslySetInnerHTML={{ __html: `<br/>` }} />;', filename: TSX },
    { code: `<div dangerouslySetInnerHTML={{ '__html': '&nbsp;' }} />;`, filename: TSX },
    // A same-file const bound to static markup, and a const markup object.
    {
      code: `const ICON = '<svg></svg>'; <i dangerouslySetInnerHTML={{ __html: ICON }} />;`,
      filename: TSX,
    },
    {
      code: `const markup = { __html: '<b>x</b>' }; <i dangerouslySetInnerHTML={markup} />;`,
      filename: TSX,
    },
    // The default sanitizers.
    { code: `<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.body) }} />;`, filename: TSX },
    { code: `<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;`, filename: TSX },
    { code: `<div dangerouslySetInnerHTML={{ __html: sanitize(html) }} />;`, filename: TSX },
    { code: `<div dangerouslySetInnerHTML={{ __html: xss(html) }} />;`, filename: TSX },
    { code: `<div dangerouslySetInnerHTML={{ __html: filterXSS(html) }} />;`, filename: TSX },
    // A sanitizer result held in a const, awaited, or cast.
    {
      code: `const clean = DOMPurify.sanitize(dirty); <div dangerouslySetInnerHTML={{ __html: clean }} />;`,
      filename: TSX,
    },
    { code: `<div dangerouslySetInnerHTML={{ __html: (await sanitize(h)) as string }} />;`, filename: TSX },
    // Every part of a template / concatenation / branch is safe.
    { code: '<p dangerouslySetInnerHTML={{ __html: `<b>${sanitize(name)}</b>` }} />;', filename: TSX },
    { code: `<p dangerouslySetInnerHTML={{ __html: '<b>' + sanitize(name) + '</b>' }} />;`, filename: TSX },
    { code: `<p dangerouslySetInnerHTML={{ __html: bold ? '<b>x</b>' : 'x' }} />;`, filename: TSX },
    { code: `<p dangerouslySetInnerHTML={{ __html: open && '<hr/>' }} />;`, filename: TSX },
    { code: `<p dangerouslySetInnerHTML={{ __html: sanitize(a) ?? '' }} />;`, filename: TSX },
    // Configured sanitizers and trusted sources.
    {
      code: `<pre dangerouslySetInnerHTML={{ __html: purify(code) }} />;`,
      filename: TSX,
      options: [{ sanitizers: ['purify()'] }],
    },
    {
      code: `<pre dangerouslySetInnerHTML={{ __html: highlighter.codeToHtml(code, opts) }} />;`,
      filename: TSX,
      options: [{ trustedSources: ['highlighter.codeToHtml()'] }],
    },
    {
      code: `<article dangerouslySetInnerHTML={{ __html: post.contentHtml }} />;`,
      filename: TSX,
      options: [{ trustedSources: ['post.contentHtml'] }],
    },
    {
      code: `<div dangerouslySetInnerHTML={createMarkup()} />;`,
      filename: TSX,
      options: [{ trustedSources: ['createMarkup()'] }],
    },
    // An object without `__html` renders nothing.
    { code: `<div dangerouslySetInnerHTML={{}} />;`, filename: TSX },
    // Other props, other attributes named like it on a non-JSX object.
    { code: `<div title={html} />;`, filename: TSX },
    { code: `const props = { innerHTML: html };`, filename: TS },
    // DOM sinks with static or sanitized values.
    { code: `el.innerHTML = '';`, filename: TS },
    { code: `el.innerHTML = DOMPurify.sanitize(html);`, filename: TS },
    { code: 'el.outerHTML = `<span></span>`;', filename: TS },
    { code: `el.insertAdjacentHTML('beforeend', '<li></li>');`, filename: TS },
    { code: `el.insertAdjacentHTML('beforeend', sanitize(item));`, filename: TS },
    // Not HTML sinks.
    { code: `el.textContent = html;`, filename: TS },
    { code: `el.innerText = html;`, filename: TS },
    { code: `el.insertAdjacentText('beforeend', text);`, filename: TS },
    // Reading innerHTML is not writing it.
    { code: `const copy = el.innerHTML;`, filename: TS },
  ],
  invalid: [
    // The classic: raw user content in the React prop.
    {
      code: `<div dangerouslySetInnerHTML={{ __html: comment.body }} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml', data: { sink: 'dangerouslySetInnerHTML' } }],
    },
    // Markdown output is not sanitized output.
    {
      code: `<div dangerouslySetInnerHTML={{ __html: marked(md) }} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    // One dynamic part in a template is enough.
    {
      code: '<p dangerouslySetInnerHTML={{ __html: `<b>${name}</b>` }} />;',
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    // One unsafe branch is enough.
    {
      code: `<p dangerouslySetInnerHTML={{ __html: raw ? html : '' }} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    {
      code: `<p dangerouslySetInnerHTML={{ __html: html || '<i>empty</i>' }} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    // A const markup object with a dynamic `__html`.
    {
      code: `const markup = { __html: props.html }; <i dangerouslySetInnerHTML={markup} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    // A markup object the rule cannot see into.
    {
      code: `<div dangerouslySetInnerHTML={props.markup} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    {
      code: `<div dangerouslySetInnerHTML={{ ...rest }} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    // `let` can be reassigned: not proof.
    {
      code: `let html = '<b>x</b>'; <i dangerouslySetInnerHTML={{ __html: html }} />;`,
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    // `sanitizers: []` accepts no sanitizer.
    {
      code: `<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(h) }} />;`,
      filename: TSX,
      options: [{ sanitizers: [] }],
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    // DOM sinks.
    {
      code: `el.innerHTML = message;`,
      filename: TS,
      errors: [{ messageId: 'unsanitizedHtml', data: { sink: 'innerHTML' } }],
    },
    {
      code: 'list.innerHTML += `<li>${item}</li>`;',
      filename: TS,
      errors: [{ messageId: 'unsanitizedHtml', data: { sink: 'innerHTML' } }],
    },
    {
      code: `el['outerHTML'] = html;`,
      filename: TS,
      errors: [{ messageId: 'unsanitizedHtml', data: { sink: 'outerHTML' } }],
    },
    {
      code: `document.body.insertAdjacentHTML('afterbegin', banner);`,
      filename: TS,
      errors: [{ messageId: 'unsanitizedHtml', data: { sink: 'insertAdjacentHTML' } }],
    },
  ],
});
