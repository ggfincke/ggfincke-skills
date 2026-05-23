// rules/comment-style-guide.js
// enforces `&` instead of "and" & `w/` instead of "with" in comments

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce comment style abbreviations (& for and, w/ for with)',
      category: 'Stylistic Issues',
    },
    fixable: 'code',
    schema: [],
    messages: {
      useAmpersand: 'Use "&" instead of "and" in comments',
      useWith: 'Use "w/" instead of "with" in comments',
    },
  },

  create(context)
  {
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    const stylePatterns = [
      {
        pattern: /\band\b/gi,
        messageId: 'useAmpersand',
        replacement: '&',
      },
      {
        pattern: /\bwith\b/gi,
        messageId: 'useWith',
        replacement: 'w/',
      },
    ]

    const wrapComment = (comment, text) =>
      comment.type === 'Line' ? `//${text}` : `/*${text}*/`

    return {
      Program()
      {
        const comments = sourceCode.getAllComments()

        for (const comment of comments)
        {
          const text = comment.value

          for (const { pattern, messageId, replacement } of stylePatterns)
          {
            pattern.lastIndex = 0
            if (!pattern.test(text)) continue

            context.report({
              loc: comment.loc,
              messageId,
              fix(fixer)
              {
                pattern.lastIndex = 0
                const newText = text.replace(pattern, replacement)
                return fixer.replaceText(comment, wrapComment(comment, newText))
              },
            })
          }
        }
      },
    }
  },
}

export default rule
