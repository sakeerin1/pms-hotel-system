"use strict";

const { requestHandler, runStartupTasks } = require("../server");

let bootstrapped = false;

module.exports = async (req, res) => {
  if (!bootstrapped) {
    runStartupTasks();
    bootstrapped = true;
  }
  return requestHandler(req, res);
};
