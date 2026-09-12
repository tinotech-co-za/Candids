import { cronJobs, makeFunctionReference } from "convex/server";
const crons = cronJobs();
crons.interval(
  "Expire managed albums and upload reservations",
  { minutes: 30 },
  makeFunctionReference<"mutation">("albums:cleanup"),
);
export default crons;
