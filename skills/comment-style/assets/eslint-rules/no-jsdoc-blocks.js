// rules/no-jsdoc-blocks.js
// prohibits block comments (/** */ and /* */) - use single-line // comments

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow block comments (JSDoc /** */ and plain /* */) in favor of single-line comments',
      category: 'Stylistic Issues',
    },
    fixable: null,
    schema: [],
    messages: {
      noBlockComment:
        'Block comments are not allowed. Use single-line comments (//) instead. TypeScript types provide documentation.',
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
          // every /* ... */ comment, JSDoc or not
          if (comment.type === 'Block')
          {
            context.report({
              loc: comment.loc,
              messageId: 'noBlockComment',
            })
          }
        }
      },
    }
  },
}

export default rule
