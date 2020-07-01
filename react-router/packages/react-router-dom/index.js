"use strict";
console.log(process.env.NODE_ENV)
if (process.env.NODE_ENV === "production") {
  module.exports = require("./cjs/react-router-dom.min.js");
} else {
  module.exports = require("./cjs/react-router-dom.js");
}
