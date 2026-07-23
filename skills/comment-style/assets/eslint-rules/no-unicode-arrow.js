// eslint-rules/no-unicode-arrow.js
// replace Unicode right arrows in comments with ASCII ->

import { getAllComments, wrapCommentText } from './rule-context.js'

const UNICODE_ARROW = '\u2192'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow Unicode arrow → in comments; use ASCII -> instead',
      category: 'Stylistic Issues',
    },
    fixable: 'code',
    schema: [],
    messages: {
      noUnicodeArrow: 'Use ASCII `->` instead of Unicode `\u2192` in comments.',
    },
  },

  create(context)
  {
    return {
      Program()
      {
        const comments = getAllComments(context)

        for (const comment of comments)
        {
          if (!comment.value.includes(UNICODE_ARROW)) continue

          context.report({
            loc: comment.loc,
            messageId: 'noUnicodeArrow',
            fix(fixer)
            {
              const replaced = comment.value.split(UNICODE_ARROW).join('->')
              return fixer.replaceText(
                comment,
                wrapCommentText(comment, replaced)
              )
            },
          })
        }
      },
    }
  },
}

export default rule
