import { app } from "./index";
import createServer from "@vendia/serverless-express";

const handler = createServer({ app }) as unknown as (event: unknown, context: unknown) => Promise<unknown>;

export { handler };
