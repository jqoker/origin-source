/** @jsx h */

import h from '../../../helpers/h'

export default function(editor) {
  editor.deleteWordForward()
}

export const input = (
  <value>
    <document>
      <paragraph>
        o<cursor />ne two three
      </paragraph>
    </document>
  </value>
)

export const output = (
  <value>
    <document>
      <paragraph>
        o<cursor /> two three
      </paragraph>
    </document>
  </value>
)
