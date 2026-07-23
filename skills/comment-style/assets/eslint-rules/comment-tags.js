// eslint-rules/comment-tags.js
// validate canonical structured comment-tag syntax

import { getAllComments } from './rule-context.js'

// tested against the raw comment value (everything after `//`) so the exactly-
// one-space contract matches check_comment_style.py; trimming first would let
// `//   * tag` pass here while `#   * tag` fails in Python
const TODO_PREFIX = /^\s*todo\b/i
const VALID_TODO = /^ TODO(?:\([a-z0-9][a-z0-9._/-]*\):)?\s+\S/
const TAG_PREFIX = /^\s*([*!?])/
const VALID_TAG = /^ [*!?] \S/
const LEGACY_TAG = /^\s*(?:FOOTGUN|HACK|NOTE|WARN(?:ING)?|FIXME|XXX):\s*/i

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce canonical structured comment tags',
      category: 'Stylistic Issues',
    },
    schema: [],
    messages: {
      invalidTag: 'Use `{{ tag }} ` followed by a short annotation',
      invalidTodo:
        'Use `TODO action` or `TODO(scope): action` with an uppercase TODO and lowercase scope',
      legacyTag:
        'Use a canonical `*`, `!`, `?`, or `TODO` annotation instead of `{{ tag }}`',
    },
  },

  create(context)
  {
    return {
      Program()
      {
        for (const comment of getAllComments(context))
        {
          if (comment.type !== 'Line') continue
          const text = comment.value
          const legacyTag = text.match(LEGACY_TAG)?.[0].trim()
          if (legacyTag)
          {
            context.report({
              node: comment,
              messageId: 'legacyTag',
              data: { tag: legacyTag },
            })
            continue
          }
          if (TODO_PREFIX.test(text) && !VALID_TODO.test(text))
          {
            context.report({ node: comment, messageId: 'invalidTodo' })
            continue
          }
          const tag = text.match(TAG_PREFIX)?.[1]
          if (tag && !VALID_TAG.test(text))
          {
            context.report({
              node: comment,
              messageId: 'invalidTag',
              data: { tag },
            })
          }
        }
      },
    }
  },
}

export default rule
