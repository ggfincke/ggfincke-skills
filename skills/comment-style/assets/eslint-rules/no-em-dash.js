// eslint-rules/no-em-dash.js
// flag em dashes in comments & block docs; no fixer, since the rewrite is prose

import { getAllComments } from './rule-context.js'

const EM_DASH = '\u2014'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow em dashes in comments; rewrite the sentence',
      category: 'Stylistic Issues',
    },
    schema: [],
    messages: {
      noEmDash: 'No em dashes in comments or block docs; rewrite the sentence.',
    },
  },

  create(context)
  {
    return {
      Program()
      {
        for (const comment of getAllComments(context))
        {
          if (!comment.value.includes(EM_DASH)) continue

          context.report({ loc: comment.loc, messageId: 'noEmDash' })
        }
      },
    }
  },
}

export default rule
