/** @jsx h */

import h from '../../../helpers/h'

export default function(editor) {
  editor.moveToEnd()
}

export const input = (
  <value>
    <document>
      <image>
        <anchor /> <focus />
      </image>
    </document>
  </value>
)

export const output = (
  <value>
    <document>
      <image>
        {' '}
        <cursor />
      </image>
    </document>
  </value>
)
