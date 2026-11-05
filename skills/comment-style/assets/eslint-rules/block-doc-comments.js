// eslint-rules/block-doc-comments.js
// validate sentence-style, length-capped block docs on declarations

import { getFilename, getSourceCode } from './rule-context.js'

// * caps mirror MAX_TYPE_DOC_LINES & MAX_FUNCTION_DOC_LINES in check_comment_style.py
const MAX_TYPE_DOC_LINES = 8
const MAX_DOC_LINES = 5

const TYPE_UNITS = new Set([
  'ClassDeclaration',
  'ClassExpression',
  'TSInterfaceDeclaration',
  'TSEnumDeclaration',
  'TSTypeAliasDeclaration',
  'TSModuleDeclaration',
])
const MEMBER_UNITS = new Set([
  'FunctionDeclaration',
  'VariableDeclaration',
  'MethodDefinition',
  'PropertyDefinition',
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSDeclareFunction',
  'TSMethodSignature',
  'TSPropertySignature',
  'TSEnumMember',
])

const TOOL_DIRECTIVE = /^(?:eslint|@ts-|istanbul|c8\b|v8\b)/i
// these tags carry checker semantics in JS; prose-only tags do not exempt ordinary functions
const JSDOC_TYPE_TAG =
  /(?:^|\n)\s*\*?\s*@(?:type|import|param|arg|argument|returns?|typedef|callback|template|satisfies|public|private|protected|readonly|override|extends|augments|implements|class|constructor|this|enum)\b/
const JSDOC_DEPRECATED_TAG = /(?:^|\n)\s*\*?\s*@deprecated\b/

const documentedDeclaration = (node, token) =>
{
  // a doc block above `@Injectable() class X {}` resolves to the Decorator,
  // whose owning class is its parent
  let current = node
  while (current?.type === 'Decorator') current = current.parent
  // written before `export`, the decorator falls outside the export node's
  // range, so the lookup lands on the enclosing body instead of the Decorator;
  // take the member the decorator runs into
  if (token.value === '@' && Array.isArray(current?.body))
  {
    current = current.body.find((child) => child.range[1] > token.range[0])
  }
  if (!current) return undefined
  // the lookup returns the innermost node, e.g. a method's key Identifier;
  // climb to the outermost node that starts at the same token
  while (
    current.parent &&
    current.parent.type !== 'Program' &&
    current.parent.range[0] === current.range[0]
  )
  {
    current = current.parent
  }
  if (
    current.type === 'ExportDefaultDeclaration' ||
    current.type === 'ExportNamedDeclaration'
  )
  {
    return current.declaration ?? undefined
  }
  return current
}

const isJsxComment = (comment, sourceCode) =>
{
  const before = sourceCode.text.slice(0, comment.range[0]).trimEnd()
  const after = sourceCode.text.slice(comment.range[1]).trimStart()
  return before.endsWith('{') && after.startsWith('}')
}

const docLines = (comment) =>
  comment.value
    .replace(/^\*/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())

const summaryParagraph = (comment) =>
{
  const lines = docLines(comment)
  const paragraph = []
  for (const line of lines)
  {
    if (!line)
    {
      if (paragraph.length > 0) break
      continue
    }
    if (line.startsWith('@')) break
    paragraph.push(line)
  }
  return paragraph.join(' ')
}

const startsLikeSentence = (summary) =>
  /^[A-Z0-9]/.test(summary) ||
  ['`', "'", '"', '(', '['].includes(summary[0]) ||
  /^[a-z][A-Z]/.test(summary)

const endsWithPeriod = (summary) => /\.(?:[`'"\])}]*)$/.test(summary)

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Allow sentence-style, length-capped block docs on declarations',
      category: 'Stylistic Issues',
    },
    schema: [],
    messages: {
      blockComment:
        'Use line comments for implementation rationale; block comments are reserved for TSDoc/JSDoc',
      disallowedDocumentation:
        'TSDoc/JSDoc belongs on declarations; use a plain comment above statements',
      detachedDocumentation:
        'Attach TSDoc/JSDoc directly to the declaration it documents',
      tooLong:
        'Block docs here stay within {{ limit }} lines; move detail to types or docs',
      missingSummary: 'Block documentation needs a summary sentence',
      summaryCapitalization:
        'Block documentation summary must begin with a capitalized sentence',
      summaryPeriod: 'Block documentation summary must end with a period',
    },
  },

  create(context)
  {
    const sourceCode = getSourceCode(context)
    const javascriptFile = /\.[cm]?jsx?$/.test(getFilename(context))

    return {
      Program()
      {
        for (const comment of sourceCode.getAllComments())
        {
          if (comment.type !== 'Block' || isJsxComment(comment, sourceCode))
            continue
          const isDocumentation = comment.value.startsWith('*')
          const directive = comment.value.replace(/^\s*\*?/gm, '').trim()
          if (TOOL_DIRECTIVE.test(directive)) continue
          if (!isDocumentation)
          {
            context.report({ node: comment, messageId: 'blockComment' })
            continue
          }
          if (
            JSDOC_DEPRECATED_TAG.test(comment.value) ||
            (javascriptFile && JSDOC_TYPE_TAG.test(comment.value))
          )
          {
            continue
          }
          const token = sourceCode.getTokenAfter(comment, {
            includeComments: false,
          })
          if (!token)
          {
            context.report({
              node: comment,
              messageId: 'detachedDocumentation',
            })
            continue
          }
          const gap = sourceCode.text.slice(comment.range[1], token.range[0])
          if (!/^\s*$/.test(gap) || (gap.match(/\n/g)?.length ?? 0) > 1)
          {
            context.report({
              node: comment,
              messageId: 'detachedDocumentation',
            })
            continue
          }

          const nextNode = sourceCode.getNodeByRangeIndex(token.range[0])
          const target = documentedDeclaration(nextNode, token)
          const typeUnit = TYPE_UNITS.has(target?.type)
          if (!typeUnit && !MEMBER_UNITS.has(target?.type))
          {
            context.report({
              node: comment,
              messageId: 'disallowedDocumentation',
            })
            continue
          }

          const limit = typeUnit ? MAX_TYPE_DOC_LINES : MAX_DOC_LINES
          if (docLines(comment).filter(Boolean).length > limit)
          {
            context.report({
              node: comment,
              messageId: 'tooLong',
              data: { limit },
            })
          }

          const summary = summaryParagraph(comment)
          if (!summary)
          {
            context.report({ node: comment, messageId: 'missingSummary' })
          }
          else
          {
            if (!startsLikeSentence(summary))
            {
              context.report({
                node: comment,
                messageId: 'summaryCapitalization',
              })
            }
            if (!endsWithPeriod(summary))
            {
              context.report({ node: comment, messageId: 'summaryPeriod' })
            }
          }
        }
      },
    }
  },
}

export default rule
