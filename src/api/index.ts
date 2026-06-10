import app from "./server";
import "../lib/config"; // validate env vars before anything else
import prisma from "../lib/prisma";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = app.listen(PORT, () => {
  console.log(`[api] Listening on port ${PORT}`);
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} received — shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log("[api] Goodbye.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
