"use strict";

/* G01: a program from the blocked list, as a command anywhere in the line. The list is hard-coded
   until R2 moves it to config. Read off the collapsed line, broad on purpose. */
module.exports = {
  id: "G01",
  name: "blocked-program",
  tier: "deny",
  reason: "a blocked program appears somewhere in the line",
  test: ({ line }) => /(^|[;&|`(]\s*)(sudo|su|curl|wget|ssh|scp|nc|ncat|telnet|dd|mkfs|crontab|eval|base64|xxd|python3?|pip3?)\b/.test(line),
};
