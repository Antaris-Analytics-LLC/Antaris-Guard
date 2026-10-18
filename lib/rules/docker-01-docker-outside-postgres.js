"use strict";

/* docker-01: docker exec, rm, system, and run with --privileged or / mounted. Running a local
   Postgres is the one thing sessions use Docker for. A pack rule: it moves to packs/docker in R6
   and keeps this id. The v0.1 match for docker run looked for the flag anywhere after it; it is
   read here from the first docker run on the line, which is the same answer in one pass. */
const DOCKER_SUBCOMMAND = /\bdocker\s+(exec|rm|system)/;
const DOCKER_RUN = /\bdocker\s+run\b/;
const WIDE_OPEN = /--privileged|-v\s*\/:/;

module.exports = {
  id: "docker-01",
  name: "docker-outside-postgres",
  tier: "deny",
  reason: "docker outside running a local Postgres",
  test: ({ line }) => {
    if (DOCKER_SUBCOMMAND.test(line)) return true;
    const run = DOCKER_RUN.exec(line);
    return run !== null && WIDE_OPEN.test(line.slice(run.index + run[0].length));
  },
};
