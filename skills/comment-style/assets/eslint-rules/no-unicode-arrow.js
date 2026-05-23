// rules/no-unicode-arrow.js
// bans Unicode arrow glyphs (->) in comments; use ASCII `->` per CLAUDE.md

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
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    return {
      Program()
      {
        const comments = sourceCode.getAllComments()

        for (const comment of comments)
        {
          if (!comment.value.includes(UNICODE_ARROW)) continue

          context.report({
            loc: comment.loc,
            messageId: 'noUnicodeArrow',
            fix(fixer)
            {
              const replaced = comment.value.split(UNICODE_ARROW).join('->')
              const wrapped =
                comment.type === 'Line' ? `//${replaced}` : `/*${replaced}*/`
              return fixer.replaceText(comment, wrapped)
            },
          })
        }
      },
    }
  },
}

export default rule
