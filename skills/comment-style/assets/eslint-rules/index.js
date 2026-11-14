// eslint-rules/index.js
// shared ESLint comment-style rules plugin

import blockDocComments from './block-doc-comments.js'
import commentBlockLength from './comment-block-length.js'
import commentTags from './comment-tags.js'
import fileHeader from './file-header.js'
import noEmDash from './no-em-dash.js'
import noUnicodeArrow from './no-unicode-arrow.js'
import plainCommentCase from './plain-comment-case.js'

export default {
  rules: {
    'block-doc-comments': blockDocComments,
    'comment-block-length': commentBlockLength,
    'comment-tags': commentTags,
    'file-header': fileHeader,
    'no-em-dash': noEmDash,
    'no-unicode-arrow': noUnicodeArrow,
    'plain-comment-case': plainCommentCase,
  },
}
