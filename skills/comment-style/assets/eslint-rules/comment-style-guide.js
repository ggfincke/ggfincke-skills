// rules/comment-style-guide.js
// enforces the full comment-style abbreviation set in comments (& w/ w/o calc ...)

// keep in parity w/ COMMENT_WORD_REPLACEMENTS in assets/check_comment_style.py
const REPLACEMENTS = {
  and: '&',
  with: 'w/',
  without: 'w/o',
  calculate: 'calc',
  configuration: 'config',
  information: 'info',
  function: 'func',
  variable: 'var',
  parameters: 'params',
}

const WORD_RE = new RegExp(`\\b(${Object.keys(REPLACEMENTS).join('|')})\\b`, 'gi')

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce comment-style abbreviations (& w/ w/o calc config info func var params)',
      category: 'Stylistic Issues',
    },
    fixable: 'code',
    schema: [],
    messages: {
      useAbbreviation:
        'Use comment-style abbreviations (& w/ w/o calc config info func var params).',
    },
  },

  create(context)
  {
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    const wrapComment = (comment, text) =>
      comment.type === 'Line' ? `//${text}` : `/*${text}*/`

    return {
      Program()
      {
        for (const comment of sourceCode.getAllComments())
        {
          const text = comment.value
          WORD_RE.lastIndex = 0
          if (!WORD_RE.test(text)) continue

          context.report({
            loc: comment.loc,
            messageId: 'useAbbreviation',
            fix(fixer)
            {
              const newText = text.replace(
                WORD_RE,
                (match) => REPLACEMENTS[match.toLowerCase()]
              )
              return fixer.replaceText(comment, wrapComment(comment, newText))
            },
          })
        }
      },
    }
  },
}

export default rule
