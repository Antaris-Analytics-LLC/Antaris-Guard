"use strict";

/* docker-01: docker exec, rm, system, and run with --privileged or / mounted. Running a local
   Postgres is the one thing sessions use Docker for. A pack rule: it moves to packs/docker in R6
   and keeps this id. */
module.exports = {
  id: "docker-01",
  name: "docker-outside-postgres",
  tier: "deny",
  reason: "docker outside running a local Postgres",
  test: ({ line }) => /\b(docker)\s+(exec|rm|system|run\b.*(--privileged|-v\s*\/:))/.test(line),
};
