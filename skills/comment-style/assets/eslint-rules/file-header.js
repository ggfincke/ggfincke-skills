// eslint-rules/file-header.js
// validate exact two-line repo-relative file headers

import {
  getCwd,
  getFilename,
  getSourceCode,
  resolveRepoRelative,
} from './rule-context.js'

const descriptionText = (comment) => comment.value.trim()

const isTaggedDescription = (description) =>
  /^(?:[*!?](?:\s|$)|todo(?:\([^)]*\))?:?\s)/i.test(description)

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce exact path and purpose file headers',
      category: 'Stylistic Issues',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          prefixes: {
            type: 'array',
            items: { type: 'string' },
          },
          root: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingHeader: 'File is missing a header comment with the file path',
      invalidPath:
        'File header path does not match actual file path. Expected: {{ expected }}',
      missingDescription: 'File header is missing a purpose phrase on line 2',
      descriptionNotLowercase:
        'File header purpose must begin with a lowercase letter or number',
      descriptionPeriod: 'File header purpose must not end with a period',
      taggedDescription:
        'File header purposes must be plain phrases, not tagged annotations',
      thirdHeaderLine:
        'File headers must contain exactly two consecutive comment lines',
    },
  },

  create(context)
  {
    const sourceCode = getSourceCode(context)
    const filename = getFilename(context)
    const cwd = getCwd(context)

    return {
      Program(node)
      {
        const { path: relativePath, guessed: rootIsGuessed } =
          resolveRepoRelative(filename, {
            root: context.options[0]?.root,
            cwd,
          })
        const prefixes = context.options[0]?.prefixes
        if (
          prefixes &&
          !prefixes.some((prefix) => relativePath.startsWith(prefix))
        )
        {
          return
        }

        const comments = sourceCode.getAllComments()
        const firstComment = comments[0]
        // ESLint's SourceCode normalizes a hashbang back to "Shebang" for
        // backward compatibility, so getAllComments() reports "Shebang" on
        // every ESLint version (measured on ESLint 10.7.0 / espree 11.2.0).
        // ! the "Shebang" arm is the live path, not the legacy one -- dropping
        // it breaks the rule everywhere. the "Hashbang" arm only matters if
        // this rule is ever driven by a raw espree AST, which emits the
        // ESTree-standard name
        const hasShebang =
          firstComment?.type === 'Shebang' || firstComment?.type === 'Hashbang'
        const headerIndex = hasShebang ? 1 : 0
        const headerLine = hasShebang ? 2 : 1
        const descriptionLine = headerLine + 1
        const headerComment = comments[headerIndex]

        if (
          !headerComment ||
          headerComment.loc.start.line !== headerLine ||
          headerComment.type !== 'Line'
        )
        {
          context.report({ node, messageId: 'missingHeader' })
          return
        }

        const headerPath = headerComment.value.trim()
        if (headerPath !== relativePath)
        {
          // a guessed anchor makes the expected path a guess too, so report it
          // but do not hand `eslint --fix` a rewrite it cannot justify
          const pathFix = (fixer) =>
            fixer.replaceText(headerComment, `// ${relativePath}`)
          context.report({
            node: headerComment,
            messageId: 'invalidPath',
            data: { expected: relativePath },
            fix: rootIsGuessed ? undefined : pathFix,
          })
        }

        const secondComment = comments[headerIndex + 1]
        if (
          !secondComment ||
          secondComment.loc.start.line !== descriptionLine ||
          secondComment.type !== 'Line' ||
          secondComment.value.trim() === ''
        )
        {
          context.report({
            loc: { line: descriptionLine, column: 0 },
            messageId: 'missingDescription',
          })
          return
        }

        const description = descriptionText(secondComment)
        if (!/^[a-z0-9]/.test(description))
        {
          const fix = /^[A-Z]/.test(description)
            ? (fixer) =>
                fixer.replaceText(
                  secondComment,
                  `// ${description[0].toLowerCase()}${description.slice(1)}`
                )
            : undefined
          context.report({
            node: secondComment,
            messageId: 'descriptionNotLowercase',
            fix,
          })
        }
        if (description.endsWith('.'))
        {
          context.report({
            node: secondComment,
            messageId: 'descriptionPeriod',
            fix(fixer)
            {
              return fixer.replaceText(
                secondComment,
                `// ${description.slice(0, -1)}`
              )
            },
          })
        }
        if (isTaggedDescription(description))
        {
          context.report({
            node: secondComment,
            messageId: 'taggedDescription',
          })
        }

        const thirdComment = comments[headerIndex + 2]
        if (
          thirdComment?.type === 'Line' &&
          thirdComment.loc.start.line === descriptionLine + 1
        )
        {
          context.report({
            node: thirdComment,
            messageId: 'thirdHeaderLine',
            fix(fixer)
            {
              return fixer.insertTextBefore(thirdComment, '\n')
            },
          })
        }
      },
    }
  },
}

export default rule
