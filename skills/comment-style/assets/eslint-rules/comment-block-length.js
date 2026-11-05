// eslint-rules/comment-block-length.js
// cap plain comment blocks at 3 lines & tagged comments at 2

import { getSourceCode } from './rule-context.js'

// * caps mirror MAX_PLAIN_LINES & MAX_TAG_LINES in check_comment_style.py
const MAX_PLAIN_LINES = 3
const MAX_TAG_LINES = 2

const TOOL_DIRECTIVE = /^(?:eslint|@ts-|istanbul|c8\b|v8\b|prettier-ignore)/i
const TODO_PREFIX = /^\s*todo\b/i
const TAG_PREFIX = /^\s*[*!?](?:\s|$)/

const isOwnLine = (comment, sourceCode) =>
  sourceCode.lines[comment.loc.start.line - 1]
    .slice(0, comment.loc.start.column)
    .trim() === ''

// split a run of consecutive line comments into blocks: a `*`, `!`, or `?`
// tag starts a block whose continuation lines count toward it; TODO lines are free
const blocksOf = (run) =>
{
  const blocks = []
  for (const comment of run)
  {
    if (TODO_PREFIX.test(comment.value)) continue
    const tagged = TAG_PREFIX.test(comment.value)
    if (tagged || blocks.length === 0)
    {
      blocks.push({
        start: comment,
        limit: tagged ? MAX_TAG_LINES : MAX_PLAIN_LINES,
        count: 1,
      })
    }
    else
    {
      blocks[blocks.length - 1].count += 1
    }
  }
  return blocks
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Cap plain comment blocks at 3 lines and tagged comments at 2',
      category: 'Stylistic Issues',
    },
    schema: [],
    messages: {
      plainTooLong:
        'Comment blocks stay within {{ limit }} lines; move detail to types or dev-docs',
      tagTooLong:
        'Tagged comments stay within {{ limit }} lines; move detail to types or dev-docs',
    },
  },

  create(context)
  {
    const sourceCode = getSourceCode(context)

    const report = (run) =>
    {
      for (const block of blocksOf(run))
      {
        if (block.count <= block.limit) continue
        context.report({
          node: block.start,
          messageId:
            block.limit === MAX_TAG_LINES ? 'tagTooLong' : 'plainTooLong',
          data: { limit: block.limit },
        })
      }
    }

    return {
      Program()
      {
        let run = []
        for (const comment of sourceCode.getAllComments())
        {
          const text = comment.value.trim()
          // headers, triple-slash directives, & tool directives end a run
          const counted =
            comment.type === 'Line' &&
            comment.loc.start.line > 2 &&
            !comment.value.startsWith('/') &&
            !TOOL_DIRECTIVE.test(text) &&
            isOwnLine(comment, sourceCode)
          const previous = run[run.length - 1]
          if (
            run.length > 0 &&
            (!counted || comment.loc.start.line !== previous.loc.start.line + 1)
          )
          {
            report(run)
            run = []
          }
          if (counted) run.push(comment)
        }
        if (run.length > 0) report(run)
      },
    }
  },
}

export default rule
